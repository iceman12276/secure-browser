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

export function registerAutofill(main: MainWindow): void {
  // content → main: forms detected. Reply with origin-matched metadata only.
  ipcMain.on('autofill:detected', (event, payload: DetectedForms) => {
    if (!vault.isUnlocked()) return;
    const senderOrigin = originOf(event.sender.getURL());
    // Anti-phishing: trust the SENDER's real origin, not the reported one.
    if (!senderOrigin || senderOrigin !== payload.origin) return;

    const candidates: Candidate[] = credsForOrigin(senderOrigin).map((m) => ({
      id: m.id,
      username: m.username,
      label: m.label,
    }));
    if (candidates.length > 0) event.sender.send('autofill:candidates', candidates);
  });

  // content → main (invoke): release ONE secret, only on exact origin match.
  ipcMain.handle('autofill:fill', (event, req: FillRequest): FillResult => {
    if (!vault.isUnlocked()) throw new Error('vault is locked');
    const senderOrigin = originOf(event.sender.getURL());
    if (!senderOrigin) throw new Error('unknown origin');

    // The credential must belong to the requesting page's origin.
    const owned = credsForOrigin(senderOrigin).find((m) => m.id === req.credentialId);
    if (!owned) throw new Error('origin mismatch: credential does not belong to this site');
    const secret = vault.getSecret(req.credentialId);
    return { username: owned.username, secret };
  });

  // content → main (invoke): a form was submitted; offer to save if new/changed.
  ipcMain.handle('autofill:capture', (event, req: CaptureRequest): void => {
    if (!vault.isUnlocked()) return;
    const senderOrigin = originOf(event.sender.getURL());
    if (!senderOrigin || senderOrigin !== req.origin) return;

    const existing = credsForOrigin(senderOrigin);
    const match = existing.find((m) => m.username === req.username);
    const isNew = !match;
    const isChanged = match ? vault.getSecret(match.id) !== req.secret : false;
    if (!isNew && !isChanged) return;

    const prompt: SavePrompt = { origin: senderOrigin, username: req.username, secret: req.secret };
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
    return vault.addCredential(prompt.origin, prompt.username, prompt.secret, '');
  });
}
