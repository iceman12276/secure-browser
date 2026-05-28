import { BaseWindow, WebContentsView } from 'electron';
import { join } from 'node:path';
import { TabManager, type ViewFactory, type ManagedView } from './tabs/TabManager';
import type { TabEvent } from './tabs/types';

const CHROME_HEIGHT = 88; // px reserved at top for tab strip + toolbar
const SIDEBAR_WIDTH = 320; // px reserved at right for the vault sidebar (rendered in the chrome page)

export interface MainWindow {
  baseWindow: BaseWindow;
  chromeView: WebContentsView;
  tabManager: TabManager;
}

export function createMainWindow(): MainWindow {
  const baseWindow = new BaseWindow({ width: 1200, height: 800 });

  // Chrome UI view (the Svelte toolbar/tabstrip). Trusted; gets the preload bridge.
  const chromeView = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  baseWindow.contentView.addChildView(chromeView);

  if (process.env.ELECTRON_RENDERER_URL) {
    void chromeView.webContents.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void chromeView.webContents.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Factory creates hardened tab views and attaches them below the chrome.
  const factory: ViewFactory = {
    create(onUpdate) {
      const view = new WebContentsView({
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          // No preload here in M1: arbitrary web pages get NO bridge.
          // M3 introduces a dedicated autofill content-script preload.
        },
      });
      baseWindow.contentView.addChildView(view);
      const wc = view.webContents;
      wc.on('page-title-updated', () => onUpdate());
      wc.on('did-navigate', () => onUpdate());
      wc.on('did-navigate-in-page', () => onUpdate());
      wc.on('did-start-loading', () => onUpdate());
      wc.on('did-stop-loading', () => onUpdate());
      return view as unknown as ManagedView;
    },
    destroy(view) {
      const real = view as unknown as WebContentsView;
      baseWindow.contentView.removeChildView(real);
      real.webContents.close();
    },
  };

  let broadcast: (e: TabEvent) => void = () => {};
  const tabManager = new TabManager(factory, (e) => broadcast(e));

  // Sync real webContents title/url into TabManager state on each update,
  // then push to the chrome view.
  broadcast = (event: TabEvent) => {
    for (const t of event.tabs) {
      const view = tabManagerViewFor(tabManager, t.id);
      if (view) {
        tabManager.applyTabStateSilent(t.id, {
          title: view.webContents.getTitle() || t.url,
          url: view.webContents.getURL() || t.url,
          loading: view.webContents.isLoading(),
        });
      }
    }
    chromeView.webContents.send('tab:event', tabManager.getState());
  };

  const layout = (): void => {
    const { width, height } = baseWindow.getContentBounds();
    chromeView.setBounds({ x: 0, y: 0, width, height }); // full window: hosts the toolbar (top strip) + the vault sidebar (right gutter)
    const active = tabManager.getActiveView();
    if (active) {
      active.setBounds({ x: 0, y: CHROME_HEIGHT, width: Math.max(0, width - SIDEBAR_WIDTH), height: Math.max(0, height - CHROME_HEIGHT) });
    }
  };
  baseWindow.on('resize', layout);
  chromeView.webContents.once('did-finish-load', layout);

  // Expose layout so the IPC router can re-layout after tab switches/creates.
  (tabManager as unknown as { relayout: () => void }).relayout = layout;

  return { baseWindow, chromeView, tabManager };
}

// Helper: reach a tab's live view without widening TabManager's public API.
function tabManagerViewFor(tm: TabManager, id: string): WebContentsView | null {
  return (tm as unknown as { viewOf?: (id: string) => WebContentsView | null }).viewOf?.(id) ?? null;
}
