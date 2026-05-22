import type { ElectronApplication, Page } from '@playwright/test';

// True when a window/webContents URL belongs to the chrome UI view (tab strip +
// toolbar) rather than a tab's web page. The built chrome view loads
// renderer/index.html; in dev mode (ELECTRON_RENDERER_URL) it loads a
// localhost/127.0.0.1 URL. Tab views load arbitrary web URLs.
export function isChromeUrl(url: string): boolean {
  return url.includes('index.html') || url.includes('localhost') || url.includes('127.0.0.1');
}

// A default https://example.com tab opens on launch, so there are >=2 pages
// immediately and app.firstWindow() races (it may return the tab view, whose
// title is "Example Domain"). Select the chrome page deterministically by URL.
export async function getChromePage(app: ElectronApplication): Promise<Page> {
  for (let i = 0; i < 100; i++) {
    for (const w of app.windows()) {
      if (isChromeUrl(w.url())) return w;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('chrome page not found');
}
