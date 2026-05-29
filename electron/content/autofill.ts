import { ipcRenderer } from 'electron';
import { detectForms } from './formParser';
import { showOverlay, removeOverlay } from './overlay';
import type { Candidate, CaptureRequest, DetectedForms, FillResult } from './messages';

// NOTE: this preload does NOT contextBridge any vault API into the page.
// The page can only ever receive a single secret value written into one
// input at fill time. No vault read/list capability is exposed to page JS.

let detected: DetectedForms | null = null;

function scanAndReport(): void {
  const forms = detectForms(document);
  if (forms.length === 0) return;
  detected = { origin: location.origin, forms };
  ipcRenderer.send('autofill:detected', detected);

  // Re-scan on submit to capture entered credentials.
  for (const f of forms) {
    const formEl = document.querySelectorAll('form')[f.formIndex] ?? document.body;
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
    username: user?.value ?? '',
    secret: pw.value,
  };
  ipcRenderer.invoke('autofill:capture', payload).catch((err: unknown) => {
    // Surface capture failures — do not swallow silently.
    console.error('[autofill] capture failed:', err instanceof Error ? err.message : String(err));
  });
}

// Main pushes origin-matched candidate metadata (no secrets).
ipcRenderer.on('autofill:candidates', (_e, candidates: Candidate[]) => {
  if (!detected || candidates.length === 0) return;
  const first = detected.forms[0];
  const anchor =
    (first.usernameSelector && document.querySelector<HTMLElement>(first.usernameSelector)) ||
    document.querySelector<HTMLElement>(first.passwordSelector);
  if (!anchor) return;

  showOverlay(anchor, candidates, (credentialId) => {
    // User gesture → request the single plaintext release for this fill.
    ipcRenderer
      .invoke('autofill:fill', { credentialId })
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

window.addEventListener('DOMContentLoaded', scanAndReport);
window.addEventListener('beforeunload', removeOverlay);
