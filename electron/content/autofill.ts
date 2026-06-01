import { ipcRenderer } from 'electron';
import { detectForms } from './formParser';
import { showOverlay, removeOverlay } from './overlay';
import type { Candidate, CaptureRequest, DetectedForms, FillRequest, FillResult } from './messages';

// NOTE: this preload does NOT contextBridge any vault API into the page.
// The page can only ever receive a single secret value written into one
// input at fill time. No vault read/list capability is exposed to page JS.

let detected: DetectedForms | null = null;

// Forms already wired with a submit listener — avoid double-wiring on re-scan.
const wired = new WeakSet<Element>();

// Username-first flows (e.g. Google): the username is entered on an earlier step
// or page, so by the time the password form is submitted its own scope may have
// no username field. Remember the last username-like value the user typed and
// fall back to it at capture time. (A username is not a secret; this is page-local.)
let lastSeenUsername = '';
function recordUsername(e: Event): void {
  const t = e.target;
  if (!(t instanceof HTMLInputElement)) return;
  if (!['text', 'email', 'tel'].includes(t.type)) return;
  if ((t.type === 'email' || /user|email|login|account/i.test(`${t.name} ${t.id}`)) && t.value) {
    lastSeenUsername = t.value;
  }
}

// Idempotent: detect forms, report them, and wire a submit listener on each form
// exactly once. Safe to call repeatedly (on load and on DOM mutations) so forms
// that appear after load (SPA / multi-step flows) still get wired.
function scanAndReport(): void {
  const forms = detectForms(document);
  if (forms.length === 0) return;
  detected = { origin: location.origin, forms };
  ipcRenderer.send('autofill:detected', detected);

  const formEls = document.querySelectorAll('form');
  for (const f of forms) {
    const formEl = formEls[f.formIndex] ?? document.body;
    if (wired.has(formEl)) continue;
    wired.add(formEl);
    formEl.addEventListener(
      'submit',
      () => captureOnSubmit(f.usernameSelector, f.passwordSelector),
      { capture: true },
    );
  }
}

function captureOnSubmit(usernameSel: string | null, passwordSel: string): void {
  const pw = document.querySelector<HTMLInputElement>(passwordSel);
  const user = usernameSel ? document.querySelector<HTMLInputElement>(usernameSel) : null;
  if (!pw || !pw.value) return;
  const payload: CaptureRequest = {
    origin: location.origin,
    // Prefer this form's own username field; fall back to the username typed on
    // an earlier step (username-first flows).
    username: user?.value || lastSeenUsername || '',
    secret: pw.value,
  };
  // Consume the remembered username so it can't mislabel a later, different login.
  lastSeenUsername = '';
  ipcRenderer.invoke('autofill:capture', payload).catch((err: unknown) => {
    // Surface capture failures — do not swallow silently.
    console.error('[autofill] capture failed:', err instanceof Error ? err.message : String(err));
  });
}

// Main pushes origin-matched candidate metadata (no secrets).
ipcRenderer.on('autofill:candidates', (_e: unknown, candidates: Candidate[]) => {
  if (!detected || candidates.length === 0) return;
  const first = detected.forms[0];
  const anchor =
    (first.usernameSelector && document.querySelector<HTMLElement>(first.usernameSelector)) ||
    document.querySelector<HTMLElement>(first.passwordSelector);
  if (!anchor) return;

  showOverlay(anchor, candidates, (credentialId) => {
    // User gesture → request the single plaintext release for this fill.
    const req: FillRequest = { credentialId };
    ipcRenderer
      .invoke('autofill:fill', req)
      .then((res: FillResult) => fillForm(first.usernameSelector, first.passwordSelector, res))
      .catch((err: unknown) => {
        // Surface fill failures (origin mismatch, locked vault, no credential) — do not swallow silently.
        console.error('[autofill] fill failed:', err instanceof Error ? err.message : String(err));
      });
  });
});

function fillForm(usernameSel: string | null, passwordSel: string, res: FillResult): void {
  if (usernameSel) {
    const u = document.querySelector<HTMLInputElement>(usernameSel);
    if (u) {
      u.value = res.username;
      u.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  const p = document.querySelector<HTMLInputElement>(passwordSel);
  if (p) {
    p.value = res.secret;
    p.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// Re-scan when forms or password fields are added after load (SPA / multi-step
// flows). Gate on real form/password additions so our own overlay node never
// triggers a re-scan loop. Debounced to coalesce bursts of mutations.
let scanScheduled = false;
function scheduleScan(): void {
  if (scanScheduled) return;
  scanScheduled = true;
  setTimeout(() => {
    scanScheduled = false;
    scanAndReport();
  }, 120);
}
const observer = new MutationObserver((mutations) => {
  if (scanScheduled) return; // a re-scan is already queued — skip all per-node work
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches('[data-testid="autofill-overlay"]')) continue; // our own overlay (carries no form/password)
      if (node.matches('form, input[type="password"]') || node.querySelector('form, input[type="password"]')) {
        scheduleScan();
        return;
      }
    }
  }
});

function start(): void {
  scanAndReport();
  document.addEventListener('input', recordUsername, { capture: true });
  // An in-page (SPA) navigation starts a new login context; forget the username.
  window.addEventListener('popstate', () => {
    lastSeenUsername = '';
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

window.addEventListener('DOMContentLoaded', start);
window.addEventListener('beforeunload', () => {
  observer.disconnect();
  removeOverlay();
});
