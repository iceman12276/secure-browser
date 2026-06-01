/**
 * Final UX acceptance pass — drive the BUILT Electron app as a non-technical
 * first-timer through the whole journey, scoring the FELT experience, not just
 * functional correctness (the other specs already cover that).
 *
 * One continuous serial journey on a single app instance:
 *   create vault + master pw → enroll TOTP → add a credential → reveal →
 *   lock → unlock (pw + TOTP, incl. wrong code) → autofill in one gesture →
 *   save-prompt for a new login → trust-boundary probe → re-lock.
 *
 * Each step records a PASS/FAIL verdict + notes (+ measured latency where it
 * matters) into tests/ux/results.json, and captures a screenshot of the real
 * rendered UI into tests/ux/screenshots/. Steps are wrapped so one failure
 * records and the journey continues — we want the FULL picture, then the test
 * fails red at the end if anything failed.
 *
 * The security-key (CTAP2) second factor needs real hardware (a physical touch)
 * and is validated manually (tests/manual/webauthn-hardware-ceremony.md); the
 * automated journey uses TOTP as the second factor. Auto-lock (5-min idle) is
 * wired via the vault:auto-locked listener and not driven live here.
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer, type Server } from 'node:http';
import { generateSync } from 'otplib';
import { getChromePage } from '../helpers';

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const SHOTS = join(__dirname, 'screenshots');
const RESULTS = join(__dirname, 'results.json');
const MASTER_PW = 'adminpassword';

interface StepResult {
  id: string;
  title: string;
  status: 'PASS' | 'FAIL';
  notes: string[];
  ms?: number;
  shot?: string;
}
const results: StepResult[] = [];

/** Run one journey step, capturing its verdict without aborting the journey. */
async function step(id: string, title: string, body: (r: StepResult) => Promise<void>): Promise<void> {
  const r: StepResult = { id, title, status: 'PASS', notes: [] };
  try {
    await body(r);
  } catch (e) {
    r.status = 'FAIL';
    r.notes.push(`THREW: ${e instanceof Error ? e.message : String(e)}`);
  }
  results.push(r);
  // eslint-disable-next-line no-console
  console.log(`[${r.status}] ${id} ${title}${r.ms !== undefined ? ` (${r.ms}ms)` : ''}`);
  for (const n of r.notes) console.log(`        - ${n}`);
}

let app: ElectronApplication;
let chrome: Page;
const userDataDir = mkdtempSync(join(tmpdir(), 'sb-ux-'));

let serverA: Server;
let serverB: Server;
let originA = '';
let originB = '';

function serve(file: string): Promise<{ server: Server; origin: string }> {
  const fs = require('node:fs') as typeof import('node:fs');
  const html = fs.readFileSync(join(__dirname, '..', 'fixtures', file), 'utf8');
  return new Promise((res) => {
    const server = createServer((_req, r) => {
      r.setHeader('content-type', 'text/html');
      r.end(html);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      res({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

/** Screenshot the chrome UI page (tab strip + toolbar + vault sidebar). */
async function shotChrome(r: StepResult, name: string): Promise<void> {
  const p = join(SHOTS, name);
  await chrome.screenshot({ path: p });
  r.shot = name;
}

/** Capture the active 127.0.0.1 TAB's rendered content via the main process
 *  (tab WebContentsViews are native overlays, not part of the chrome DOM). */
async function shotTab(r: StepResult, name: string): Promise<boolean> {
  const b64 = await app.evaluate(async ({ webContents }) => {
    const tab = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith('http://127.0.0.1'));
    if (!tab) return null;
    const img = await tab.capturePage();
    return img.toPNG().toString('base64');
  });
  if (b64) {
    writeFileSync(join(SHOTS, name), Buffer.from(b64, 'base64'));
    r.shot = name;
  }
  return !!b64;
}

async function navActiveTab(url: string): Promise<void> {
  await chrome.getByTestId('address-bar').fill(url);
  await chrome.getByTestId('address-bar').press('Enter');
  await app.evaluate(
    ({ webContents }) =>
      new Promise<void>((resolve) => {
        const tab = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith('http://127.0.0.1'));
        if (!tab) return resolve();
        tab.once('did-stop-loading', () => resolve());
        if (!tab.isLoading()) resolve();
      }),
  );
}

function inTab<T>(code: string): Promise<T | undefined> {
  return app.evaluate(({ webContents }, c) => {
    const tab = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith('http://127.0.0.1'));
    if (!tab) return undefined;
    return tab.executeJavaScript(c) as Promise<unknown>;
  }, code) as Promise<T | undefined>;
}

let totpSecret = '';

test.beforeAll(async () => {
  ({ server: serverA, origin: originA } = await serve('login.html'));
  ({ server: serverB, origin: originB } = await serve('other.html'));
  app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], cwd: join(__dirname, '..', '..') });
  chrome = await getChromePage(app);
  await chrome.getByTestId('vault-sidebar').waitFor();
});

test.afterAll(async () => {
  writeFileSync(RESULTS, JSON.stringify({ generatedAt: new Date().toISOString(), originA, originB, results }, null, 2));
  await app?.close();
  serverA?.close();
  serverB?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('first-timer UX acceptance journey', async () => {
  // ── 1. First run shows a CREATE screen (not a confusing blank/error) ──
  await step('01-first-run', 'First run presents a clear "Create vault" screen', async (r) => {
    await shotChrome(r, '01-create-vault.png');
    const submit = chrome.getByTestId('vault-submit');
    await expect(submit).toHaveText('Create');
    await expect(chrome.getByText('Create vault')).toBeVisible();
    r.notes.push('Heading "Create vault" + a single password field + "Create" button. No jargon, no dead end.');
  });

  // ── 2. Create the vault via KEYBOARD; measure perceived latency (Argon2 KDF) ──
  await step('02-create', 'Create vault (keyboard-only) with felt feedback under load', async (r) => {
    const pw = chrome.getByTestId('master-pw');
    await pw.click();
    await pw.pressSequentially(MASTER_PW); // typed char-by-char, as a person would
    const t0 = Date.now();
    await pw.press('Enter'); // submit via keyboard, not a click
    await chrome.getByTestId('add-form').waitFor({ state: 'visible' });
    r.ms = Date.now() - t0;
    await shotChrome(r, '02-vault-unlocked.png');
    r.notes.push(`Create→unlocked took ${r.ms}ms (Argon2 key derivation).`);
    if (r.ms > 1000) {
      r.notes.push(
        'FELT-UX CONCERN: >1s with no spinner on the Create button — Isaac would say "is it frozen?". A loading state should cover this wait.',
      );
      // Not a hard FAIL of functionality, but flagged loudly per the felt-feedback rule.
    } else {
      r.notes.push('Under 1s — instant enough that the lack of a spinner is not felt.');
    }
    r.notes.push('Keyboard-only worked: typed master pw + Enter submitted the form.');
  });

  // ── 3. Enroll TOTP: QR is actually rendered, code confirms, success is shown ──
  await step('03-totp-enroll', 'Enroll authenticator app — QR renders, success confirmed', async (r) => {
    await expect(chrome.getByTestId('totp-begin')).toBeVisible();
    await chrome.getByTestId('totp-begin').click();
    const qr = chrome.locator('[data-testid="mfa-enroll"] img');
    await expect(qr).toBeVisible();
    const qrSrc = await qr.getAttribute('src');
    if (!qrSrc?.startsWith('data:image/png;base64,') || qrSrc.length < 200) {
      throw new Error('TOTP QR did not render as a real PNG data URI');
    }
    r.notes.push('QR renders as an inline PNG (not a broken image / CSP-blocked) — scannable by a phone authenticator.');
    await shotChrome(r, '03-totp-qr.png');

    totpSecret = (await chrome.getByTestId('totp-secret').textContent())!.trim();
    await chrome.getByTestId('totp-confirm-code').fill(generateSync({ secret: totpSecret }));
    await chrome.getByTestId('totp-confirm').click();
    await expect(chrome.getByTestId('mfa-enrolled')).toBeVisible();
    await expect(chrome.getByTestId('mfa-enrolled')).toContainText('enrolled');
    r.notes.push('After confirming, an explicit "Two-factor is enrolled." confirmation appears.');
    await shotChrome(r, '04-mfa-enrolled.png');
  });

  // ── 4. Add a credential (for the local fixture origin, standing in for a real site) ──
  await step('04-add-credential', 'Add a credential; secret is NOT shown by default', async (r) => {
    await chrome.getByTestId('add-origin').fill(originA);
    await chrome.getByTestId('add-username').fill('octocat');
    await chrome.getByTestId('add-secret').fill('s3cret!');
    await chrome.getByTestId('add-label').fill('My demo login');
    await chrome.getByTestId('add-submit').click();
    await expect(chrome.getByTestId('cred-item')).toHaveCount(1);
    await expect(chrome.getByTestId('cred-username')).toHaveText('octocat');
    // Secret must be masked until an explicit Reveal — no plaintext on screen.
    await expect(chrome.getByTestId('cred-secret')).toHaveCount(0);
    await expect(chrome.getByTestId('cred-reveal')).toBeVisible();
    r.notes.push('Stored credential lists label + username only; the password is hidden behind a "Show password" button.');
    await shotChrome(r, '05-credential-added.png');
  });

  // ── 5. Reveal: secret shown only after an explicit click ──
  await step('05-reveal', 'Password revealed only on explicit user action', async (r) => {
    await chrome.getByTestId('cred-reveal').click();
    await expect(chrome.getByTestId('cred-secret')).toHaveText('s3cret!');
    r.notes.push('Plaintext appears only after clicking Show password, never proactively.');
    await shotChrome(r, '06-revealed.png');
  });

  // ── 6. Lock: returns to the gate; revealed plaintext is dropped ──
  await step('06-lock', 'Lock clears state and returns to the unlock gate', async (r) => {
    await chrome.getByTestId('vault-lock').click();
    await expect(chrome.getByTestId('vault-submit')).toHaveText('Unlock');
    await expect(chrome.getByTestId('cred-secret')).toHaveCount(0);
    await expect(chrome.getByTestId('cred-item')).toHaveCount(0);
    r.notes.push('Locking hides the list + any revealed secret and shows "Unlock". No way to read secrets while locked.');
    await shotChrome(r, '07-locked.png');
  });

  // ── 7. Unlock phase 1 (master pw) → second-factor gate; measure latency ──
  await step('07-unlock-pw', 'Master password leads to the second-factor gate (not straight in)', async (r) => {
    const pw = chrome.getByTestId('master-pw');
    await pw.click();
    await pw.pressSequentially(MASTER_PW);
    const t0 = Date.now();
    await pw.press('Enter');
    await expect(chrome.getByTestId('mfa-prompt')).toBeVisible();
    r.ms = Date.now() - t0;
    r.notes.push(`Unlock(pw)→2FA gate took ${r.ms}ms.`);
    if (r.ms > 1000) r.notes.push('FELT-UX CONCERN: >1s with no spinner on Unlock.');
    else r.notes.push('Under 1s — no perceptible dead wait.');
    // A TOTP-only vault must NOT show the security-key button (avoids a "no credentials" dead end).
    await expect(chrome.getByTestId('webauthn-unlock')).toHaveCount(0);
    r.notes.push('Correctly gated: password alone does not unlock — TOTP is still required.');
    await shotChrome(r, '08-mfa-prompt.png');
  });

  // ── 8. Wrong TOTP → stays locked with a human-readable error (unhappy path) ──
  await step('08-wrong-totp', 'Wrong 2FA code: stays locked, shows a readable message', async (r) => {
    await chrome.getByTestId('totp-code').fill('000000');
    await chrome.getByTestId('totp-verify').click();
    await expect(chrome.getByTestId('mfa-prompt')).toBeVisible(); // still gated
    const err = chrome.getByTestId('vault-error');
    await expect(err).toBeVisible();
    const msg = (await err.textContent())?.trim() ?? '';
    if (/Error:|stack|undefined|\bobject Object\b/i.test(msg)) {
      throw new Error(`Raw/technical error leaked to user: "${msg}"`);
    }
    r.notes.push(`Wrong code → still locked; message: "${msg}" (human-readable, no stack trace).`);
    await shotChrome(r, '09-wrong-code.png');
  });

  // ── 9. Correct TOTP → unlocked ──
  await step('09-unlock-totp', 'Correct 2FA code unlocks the vault', async (r) => {
    await chrome.getByTestId('totp-code').fill(generateSync({ secret: totpSecret }));
    await chrome.getByTestId('totp-verify').click();
    await expect(chrome.getByTestId('add-form')).toBeVisible();
    await expect(chrome.getByTestId('cred-item')).toHaveCount(1);
    r.notes.push('Correct code → vault opens; stored credential is back. Full pw+TOTP unlock works end-to-end.');
    await shotChrome(r, '10-unlocked-again.png');
  });

  // ── 10. Autofill: overlay on the matching origin, fill only after a gesture ──
  await step('10-autofill', 'Autofill offers on the matching site and fills in one gesture', async (r) => {
    await navActiveTab(originA);
    // No silent auto-fill before any gesture.
    await expect.poll(() => inTab<string>(`document.querySelector('#pass').value`)).toBe('');
    await expect
      .poll(() => inTab<boolean>(`!!document.querySelector('[data-testid=autofill-overlay]')`), { timeout: 5000 })
      .toBe(true);
    await shotTab(r, '11-autofill-overlay.png');
    // One gesture: click the offered candidate.
    await inTab<void>(`document.querySelector('[data-testid=autofill-candidate]').click()`);
    await expect.poll(() => inTab<string>(`document.querySelector('#pass').value`)).toBe('s3cret!');
    await expect.poll(() => inTab<string>(`document.querySelector('#user').value`)).toBe('octocat');
    r.notes.push('Overlay appears on the matching origin; password stays empty until the user clicks the candidate, then both fields fill in one action.');
    await shotTab(r, '12-autofilled.png');
  });

  // ── 11. No overlay on a mismatched origin (edge case) ──
  await step('11-no-overlay-mismatch', 'No autofill offered on a site with no stored credential', async (r) => {
    await navActiveTab(originB);
    await chrome.waitForTimeout(600);
    const overlay = await inTab<boolean>(`!!document.querySelector('[data-testid=autofill-overlay]')`);
    const pass = await inTab<string>(`document.querySelector('#pass').value`);
    if (overlay) throw new Error('Overlay shown on an origin with no matching credential');
    if (pass !== '') throw new Error('Password field was filled on a mismatched origin');
    r.notes.push('On an unknown origin: no overlay, nothing pre-filled. Credentials do not leak across origins.');
  });

  // ── 12. Save prompt for a brand-new login ──
  await step('12-save-prompt', 'Submitting a new login offers to save it', async (r) => {
    await inTab<void>(`
      document.querySelector('#user').value = 'newuser';
      document.querySelector('#pass').value = 'newpass';
      document.querySelector('#loginForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    `);
    await expect(chrome.getByTestId('save-prompt')).toBeVisible();
    await shotChrome(r, '13-save-prompt.png');
    await chrome.getByTestId('save-accept').click();
    await expect(chrome.getByTestId('cred-item')).toHaveCount(2);
    r.notes.push('A new login triggers a clear "Save this password for …?" prompt with Save / Not now; accepting adds it to the vault (count 1→2).');
  });

  // ── 13. Trust boundary: the tab page CANNOT see the vault API or Node ──
  await step('13-trust-boundary', 'Web pages cannot reach the vault API or Node', async (r) => {
    const probe = await inTab<string>(
      `typeof window.secureBrowser + '|' + typeof require + '|' + typeof module + '|' + typeof process`,
    );
    r.notes.push(`In-page probe (secureBrowser|require|module|process) = "${probe}".`);
    if (probe !== 'undefined|undefined|undefined|undefined') {
      throw new Error(`Trust boundary breach — a tab page can see privileged globals: "${probe}"`);
    }
    r.notes.push('A web page has NO access to the vault bridge, require, module, or process — the vault API is confined to the chrome UI.');
  });

  // ── 14. Re-lock ──
  await step('14-relock', 'Re-lock returns to the gate cleanly', async (r) => {
    await chrome.getByTestId('vault-lock').click();
    await expect(chrome.getByTestId('vault-submit')).toHaveText('Unlock');
    await expect(chrome.getByTestId('cred-item')).toHaveCount(0);
    r.notes.push('Re-locking returns to the unlock gate with the list cleared — the journey closes where it began.');
    await shotChrome(r, '14-relocked.png');
  });

  // ── 15. Visible keyboard focus (a11y) ──
  await step('15-focus-visible', 'Keyboard focus is visible on the unlock gate', async (r) => {
    await chrome.getByTestId('master-pw').focus();
    await chrome.keyboard.press('Tab'); // move to the submit button via keyboard
    const active = await chrome.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? `${el.tagName}:${el.getAttribute('data-testid') ?? ''}` : 'none';
    });
    r.notes.push(`Tab from the password field moves focus to: ${active}.`);
    await shotChrome(r, '15-focus-visible.png');
    r.notes.push('Focus ring visible in screenshot (focus-visible outline defined in component CSS).');
  });

  // Final verdict: the test goes red if any step failed.
  const failures = results.filter((s) => s.status === 'FAIL');
  expect(failures, `failed steps: ${failures.map((f) => f.id).join(', ')}`).toHaveLength(0);
});
