import { app } from 'electron';
import { join } from 'node:path';
import { Vault } from 'secure-browser-core';

// One vault, stored under the OS per-user app data dir.
const vaultDir = join(app.getPath('userData'), 'vault');
export const vault = new Vault(vaultDir);
