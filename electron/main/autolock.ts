import type { MainWindow } from './window';
import { vault } from './vault';

const IDLE_MS = 5 * 60 * 1000; // 5 minutes

export class AutoLock {
  private lastActivity = Date.now();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly main: MainWindow) {}

  start(): void {
    this.timer = setInterval(() => this.tick(), 30_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Call on any vault activity to reset the idle clock. */
  touch(): void {
    this.lastActivity = Date.now();
  }

  private tick(): void {
    if (!vault.isUnlocked()) return;
    if (Date.now() - this.lastActivity >= IDLE_MS) {
      vault.lock();
      this.main.chromeView.webContents.send('vault:auto-locked');
    }
  }
}
