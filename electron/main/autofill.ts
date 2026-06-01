import { ipcMain } from 'electron';
import type { MainWindow } from './window';
import { vault } from './vault';
import type {
  Candidate,
  CaptureRequest,
  DetectedForms,
  FillRequest,
  FillResult,
  SavePrompt,
} from '../content/messages';

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

const credsForOrigin = (origin: string) => vault.list().filter((m) => m.origin === origin);

// All three autofill handlers derive the authoritative origin from event.senderFrame
// (the actual sending frame) rather than event.sender.getURL() (the top-frame URL).
// This prevents a cross-origin iframe in the same WebContents from being authorized
// with the parent page's origin. A dedicated e2e regression for the sub-frame path is
// not feasible without weakening sandbox:true / nodeIntegrationInSubFrames (default
// false), which would prevent the content-script preload from running in sub-frames;
// the fix is therefore verified by code audit and the existing same-origin suite.
export function registerAutofill(main: MainWindow): void {
  // content → main: forms detected. Reply with origin-matched metadata only.
  // Authorization is bound to event.senderFrame (the actual sending frame) to prevent
  // sub-frame origin confusion.
  ipcMain.on('autofill:detected', (event, payload: DetectedForms) => {
    if (!vault.isUnlocked()) return;
    // Derive origin from the SENDER FRAME, not the top-frame URL, to prevent
    // a cross-origin sub-frame from being authorized with the parent page's origin.
    const frame = event.senderFrame;
    if (!frame) return; // Frame detached/navigated — abort with no fallback.
    const senderOrigin = originOf(frame.url);
    // Anti-phishing: trust the SENDER FRAME's real origin, not the reported one.
    if (!senderOrigin || senderOrigin !== payload.origin) return;

    const candidates: Candidate[] = credsForOrigin(senderOrigin).map((m) => ({
      id: m.id,
      username: m.username,
      label: m.label,
    }));
    // Deliver candidates ONLY to the requesting frame, not to the whole WebContents,
    // so a sibling or parent frame cannot receive candidate metadata.
    if (candidates.length > 0) frame.send('autofill:candidates', candidates);
  });

  // content → main (invoke): release ONE secret, only on exact origin match.
  // Authorization is bound to event.senderFrame (the actual sending frame) to prevent
  // a cross-origin sub-frame from harvesting a credential belonging to the parent origin.
  ipcMain.handle('autofill:fill', (event, req: FillRequest): FillResult => {
    if (!vault.isUnlocked()) throw new Error('vault is locked');
    // Derive origin from the SENDER FRAME, not the top-frame URL.
    const frame = event.senderFrame;
    if (!frame) throw new Error('unknown origin'); // Frame detached/navigated — abort.
    const senderOrigin = originOf(frame.url);
    if (!senderOrigin) throw new Error('unknown origin');

    // The credential must belong to the requesting frame's origin.
    const owned = credsForOrigin(senderOrigin).find((m) => m.id === req.credentialId);
    if (!owned) throw new Error('origin mismatch: credential does not belong to this site');
    const secret = vault.getSecret(req.credentialId);
    return { username: owned.username, secret };
  });

  // content → main (invoke): a form was submitted; offer to save if new/changed.
  // Authorization is bound to event.senderFrame (the actual sending frame) to prevent
  // a cross-origin sub-frame from triggering a save-prompt for the parent page's origin.
  ipcMain.handle('autofill:capture', (event, req: CaptureRequest): void => {
    if (!vault.isUnlocked()) return;
    // Derive origin from the SENDER FRAME, not the top-frame URL.
    const frame = event.senderFrame;
    if (!frame) return; // Frame detached/navigated — abort with no fallback.
    const senderOrigin = originOf(frame.url);
    if (!senderOrigin || senderOrigin !== req.origin) return;

    const existing = credsForOrigin(senderOrigin);
    // De-duplicate ONLY on a real (non-empty) username; an empty username is
    // "unknown", so distinct password-only logins never collapse onto one row.
    const match = req.username ? existing.find((m) => m.username === req.username) : undefined;
    const isNew = !match;
    const isChanged = match ? vault.getSecret(match.id) !== req.secret : false;
    if (!isNew && !isChanged) return;

    const prompt: SavePrompt = {
      origin: senderOrigin,
      username: req.username,
      secret: req.secret,
      update: !isNew, // overwriting an existing entry vs saving a new one
    };
    main.chromeView.webContents.send('autofill:save-prompt', prompt);
  });

  // chrome → main: user accepted the save prompt.
  ipcMain.handle('vault:saveFromPrompt', (_e, p: unknown) => {
    const prompt = p as SavePrompt;
    if (
      typeof prompt?.origin !== 'string' ||
      typeof prompt?.username !== 'string' ||
      typeof prompt?.secret !== 'string'
    ) {
      throw new Error('invalid save payload');
    }
    // Update an existing entry (same origin + non-empty username) in place rather
    // than inserting a duplicate; otherwise add it as new. An empty username is
    // treated as new so distinct password-only logins are never collapsed.
    const match = prompt.username
      ? vault.getCredentials(prompt.origin).find((m) => m.username === prompt.username)
      : undefined;
    if (match) {
      vault.updateCredential(match.id, prompt.secret);
      return match.id;
    }
    return vault.addCredential(prompt.origin, prompt.username, prompt.secret, '');
  });
}
