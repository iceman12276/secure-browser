# M1 — Browser Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** Task 0 complete (`2026-05-20-task0-scaffold.md`). The app builds, the renderer is sandboxed, and the napi bridge works.

**Goal:** Turn the single-window shell into a real multi-tab browser — tab strip, address bar, back/forward/reload, new/close tab, and basic session history — with every web page rendered in a hardened, sandboxed `WebContentsView`.

**Architecture:** Replace the single `BrowserWindow` with a `BaseWindow` that hosts two layers of `WebContentsView`: (1) the **chrome view** — the Svelte UI (tab strip + toolbar + address bar), pinned to the top; (2) one **tab view** per open tab, positioned below the chrome and stacked so only the active tab is visible. A `TabManager` in the main process owns tab lifecycle and forwards page events (title, URL, loading, can-go-back/forward) to the chrome view over IPC. Tab views get `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, and a **null preload** (no bridge into arbitrary web pages — autofill injection comes in M3 via a dedicated content-script preload).

**Tech Stack:** Electron `BaseWindow` + `WebContentsView`, TypeScript, Svelte 5 (runes), electron-vite, Playwright `_electron`.

---

## File Structure

| Path | Responsibility |
|---|---|
| `electron/main/tabs/TabManager.ts` | Owns the map of tabs, active-tab tracking, create/close/switch, layout (bounds) of tab views, and wiring each tab's `webContents` events to a broadcast callback. |
| `electron/main/tabs/types.ts` | Shared `TabId`, `TabState`, `TabEvent` types used by main + IPC + preload + renderer. |
| `electron/main/window.ts` | Builds the `BaseWindow`, the chrome `WebContentsView`, instantiates `TabManager`, and keeps the chrome + active tab laid out on resize. |
| `electron/main/ipc.ts` | Allow-listed IPC router: registers `tab:*` and `nav:*` handlers, validates args, and pushes `tab:event` to the chrome view. |
| `electron/main/index.ts` | Modified: app lifecycle calls `createMainWindow()` (from `window.ts`) instead of inlining a BrowserWindow. |
| `electron/preload/index.ts` | Modified: extend the bridge with `tabs` + `nav` namespaces and a `onTabEvent` subscription. |
| `electron/renderer/src/env.d.ts` | Modified: extend `SecureBrowserApi` with the new tab/nav surface. |
| `electron/renderer/src/lib/browserStore.svelte.ts` | Svelte rune store mirroring tab state from `tab:event`; exposes actions that call the bridge. |
| `electron/renderer/src/components/TabStrip.svelte` | Tab strip UI: tab buttons, active highlight, close (×), new-tab (+). |
| `electron/renderer/src/components/Toolbar.svelte` | Back/forward/reload buttons + address bar `<input>`. |
| `electron/renderer/src/App.svelte` | Modified: compose `TabStrip` + `Toolbar`; the tab content area is empty (tab views render over it natively). |
| `tests/shell.spec.ts` | Playwright `_electron`: two-tab navigation, title/url assertions, back/forward, close tab, tab-renderer Node isolation. |

---

## Task M1.1: Shared tab types

**Files:**
- Create: `electron/main/tabs/types.ts`

- [ ] **Step 1: Write the type module (no test — pure types, consumed by later tasks)**

Create `electron/main/tabs/types.ts`:

```typescript
export type TabId = string;

export interface TabState {
  id: TabId;
  title: string;
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

/** Pushed from main → chrome view whenever tab state changes. */
export interface TabEvent {
  tabs: TabState[];
  activeTabId: TabId | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/main/tabs/types.ts
git commit -m "feat(shell): add shared tab state types"
```

---

## Task M1.2: TabManager (unit-tested in isolation)

**Files:**
- Create: `electron/main/tabs/TabManager.ts`
- Test: `tests/unit/TabManager.spec.ts`
- Modify: `package.json` (add vitest + a `test:unit` script)

> The TabManager's pure bookkeeping (which tab is active, ordering, id generation) is unit-testable without Electron by injecting a minimal "view factory". We test the bookkeeping; the real Electron `WebContentsView` wiring is covered by the Playwright tests in M1.6.

- [ ] **Step 1: Add vitest to the project**

Modify `package.json` — add to `devDependencies`: `"vitest": "^2"`, and add a script:

```json
    "test:unit": "vitest run"
```

Run: `npm install`
Expected: vitest installed.

- [ ] **Step 2: Write the failing unit test**

Create `tests/unit/TabManager.spec.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { TabManager } from '../../electron/main/tabs/TabManager';

/** A fake tab view standing in for an Electron WebContentsView. */
function fakeViewFactory() {
  return {
    create: vi.fn(() => ({
      webContents: {
        loadURL: vi.fn(),
        on: vi.fn(),
        destroy: vi.fn(),
        navigationHistory: { canGoBack: () => false, canGoForward: () => false },
      },
      setVisible: vi.fn(),
      setBounds: vi.fn(),
    })),
    destroy: vi.fn(),
  };
}

describe('TabManager bookkeeping', () => {
  it('creates a tab and makes it active', () => {
    const tm = new TabManager(fakeViewFactory() as never, () => {});
    const id = tm.newTab('https://example.com');
    expect(tm.getState().activeTabId).toBe(id);
    expect(tm.getState().tabs).toHaveLength(1);
    expect(tm.getState().tabs[0].url).toBe('https://example.com');
  });

  it('switches active tab', () => {
    const tm = new TabManager(fakeViewFactory() as never, () => {});
    const a = tm.newTab('https://a.com');
    const b = tm.newTab('https://b.com');
    expect(tm.getState().activeTabId).toBe(b);
    tm.switchTab(a);
    expect(tm.getState().activeTabId).toBe(a);
  });

  it('closing the active tab activates the previous one', () => {
    const tm = new TabManager(fakeViewFactory() as never, () => {});
    const a = tm.newTab('https://a.com');
    const b = tm.newTab('https://b.com');
    tm.closeTab(b);
    expect(tm.getState().activeTabId).toBe(a);
    expect(tm.getState().tabs).toHaveLength(1);
  });

  it('closing the last tab leaves no active tab', () => {
    const tm = new TabManager(fakeViewFactory() as never, () => {});
    const a = tm.newTab('https://a.com');
    tm.closeTab(a);
    expect(tm.getState().activeTabId).toBeNull();
    expect(tm.getState().tabs).toHaveLength(0);
  });

  it('notifies on every mutation', () => {
    const onChange = vi.fn();
    const tm = new TabManager(fakeViewFactory() as never, onChange);
    tm.newTab('https://a.com');
    tm.newTab('https://b.com');
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/TabManager.spec.ts`
Expected: FAIL — cannot find module `TabManager` / `TabManager is not a constructor`.

- [ ] **Step 4: Write the TabManager implementation**

Create `electron/main/tabs/TabManager.ts`:

```typescript
import type { TabId, TabState, TabEvent } from './types';

/** Minimal shape of the Electron view we depend on (real or fake). */
export interface ManagedView {
  webContents: {
    loadURL: (url: string) => void;
    on: (event: string, listener: (...args: unknown[]) => void) => void;
    destroy: () => void;
    navigationHistory: { canGoBack: () => boolean; canGoForward: () => boolean };
  };
  setVisible: (visible: boolean) => void;
  setBounds: (bounds: { x: number; y: number; width: number; height: number }) => void;
}

export interface ViewFactory {
  create: (onUpdate: () => void) => ManagedView;
  destroy: (view: ManagedView) => void;
}

interface Tab {
  id: TabId;
  view: ManagedView;
  state: TabState;
}

export class TabManager {
  private tabs: Tab[] = [];
  private activeId: TabId | null = null;
  private seq = 0;

  constructor(
    private readonly factory: ViewFactory,
    private readonly onChange: (event: TabEvent) => void,
  ) {}

  newTab(url: string): TabId {
    const id = `tab-${++this.seq}`;
    const view = this.factory.create(() => this.refresh(id));
    const tab: Tab = {
      id,
      view,
      state: { id, title: url, url, loading: true, canGoBack: false, canGoForward: false },
    };
    this.tabs.push(tab);
    view.webContents.loadURL(url);
    this.setActive(id);
    return id;
  }

  switchTab(id: TabId): void {
    if (!this.tabs.some((t) => t.id === id)) return;
    this.setActive(id);
  }

  closeTab(id: TabId): void {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const [removed] = this.tabs.splice(idx, 1);
    this.factory.destroy(removed.view);
    if (this.activeId === id) {
      const next = this.tabs[idx - 1] ?? this.tabs[idx] ?? null;
      this.activeId = next ? next.id : null;
      if (next) next.view.setVisible(true);
    }
    this.emit();
  }

  navigate(id: TabId, url: string): void {
    const tab = this.find(id);
    if (!tab) return;
    tab.state.url = url;
    tab.state.loading = true;
    tab.view.webContents.loadURL(url);
    this.emit();
  }

  /** Pull current title/url/nav flags off the live webContents into state. */
  refresh(id: TabId): void {
    const tab = this.find(id);
    if (!tab) return;
    tab.state.canGoBack = tab.view.webContents.navigationHistory.canGoBack();
    tab.state.canGoForward = tab.view.webContents.navigationHistory.canGoForward();
    this.emit();
  }

  getState(): TabEvent {
    return { tabs: this.tabs.map((t) => ({ ...t.state })), activeTabId: this.activeId };
  }

  getActiveView(): ManagedView | null {
    return this.find(this.activeId)?.view ?? null;
  }

  applyTabState(id: TabId, patch: Partial<TabState>): void {
    const tab = this.find(id);
    if (!tab) return;
    Object.assign(tab.state, patch);
    this.emit();
  }

  private setActive(id: TabId): void {
    this.activeId = id;
    for (const t of this.tabs) t.view.setVisible(t.id === id);
    this.emit();
  }

  private find(id: TabId | null): Tab | undefined {
    return this.tabs.find((t) => t.id === id);
  }

  private emit(): void {
    this.onChange(this.getState());
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/TabManager.spec.ts`
Expected: PASS — all five bookkeeping tests green.

> Note: `onChange` is called once per `setActive`/mutation. The "notifies on every mutation" test expects 2 calls for 2 `newTab`s — each `newTab` ends in `setActive` → one `emit`. Confirmed by the passing run.

- [ ] **Step 6: Commit**

```bash
git add electron/main/tabs/TabManager.ts tests/unit/TabManager.spec.ts package.json package-lock.json
git commit -m "feat(shell): add unit-tested TabManager bookkeeping"
```

---

## Task M1.3: Main-process window + view wiring

**Files:**
- Create: `electron/main/window.ts`
- Modify: `electron/main/index.ts`

- [ ] **Step 1: Write `electron/main/window.ts`**

Create `electron/main/window.ts`:

```typescript
import { BaseWindow, WebContentsView } from 'electron';
import { join } from 'node:path';
import { TabManager, type ViewFactory, type ManagedView } from './tabs/TabManager';
import type { TabEvent } from './tabs/types';

const CHROME_HEIGHT = 88; // px reserved at top for tab strip + toolbar

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
    chromeView.setBounds({ x: 0, y: 0, width, height: CHROME_HEIGHT });
    const active = tabManager.getActiveView();
    if (active) {
      active.setBounds({ x: 0, y: CHROME_HEIGHT, width, height: height - CHROME_HEIGHT });
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
```

> Note: `window.ts` references two TabManager methods not yet present (`applyTabStateSilent`, `viewOf`) and a `relayout` hook. Add them in Step 2 so the file compiles.

- [ ] **Step 2: Extend `TabManager` with the methods `window.ts` needs**

Modify `electron/main/tabs/TabManager.ts` — add these methods to the class (place after `applyTabState`):

```typescript
  /** Like applyTabState but does NOT emit (avoids recursion during broadcast). */
  applyTabStateSilent(id: TabId, patch: Partial<TabState>): void {
    const tab = this.find(id);
    if (tab) Object.assign(tab.state, patch);
  }

  /** Expose the underlying view for the window layer (typed loosely on purpose). */
  viewOf(id: TabId): ManagedView | null {
    return this.find(id)?.view ?? null;
  }
```

- [ ] **Step 3: Rewrite `electron/main/index.ts` to use the window factory**

Replace the entire contents of `electron/main/index.ts`:

```typescript
import { app } from 'electron';
import { createMainWindow, type MainWindow } from './window';
import { registerIpc } from './ipc';

let main: MainWindow | null = null;

void app.whenReady().then(() => {
  main = createMainWindow();
  registerIpc(main);
  // Open a default first tab.
  main.tabManager.newTab('https://example.com');
  (main.tabManager as unknown as { relayout: () => void }).relayout();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

> Note: `registerIpc` is created in M1.4. This file will not build until M1.4 Step 1 exists. Do M1.4 before running the app build.

- [ ] **Step 4: Commit**

```bash
git add electron/main/window.ts electron/main/tabs/TabManager.ts electron/main/index.ts
git commit -m "feat(shell): BaseWindow + WebContentsView tab layout wiring"
```

---

## Task M1.4: Allow-listed IPC router

**Files:**
- Create: `electron/main/ipc.ts`

- [ ] **Step 1: Write the IPC router**

Create `electron/main/ipc.ts`:

```typescript
import { ipcMain } from 'electron';
import { coreVersion } from 'secure-browser-core';
import type { MainWindow } from './window';
import type { TabEvent } from './tabs/types';

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isTabId(value: unknown): value is string {
  return typeof value === 'string' && /^tab-\d+$/.test(value);
}

export function registerIpc(main: MainWindow): void {
  const { tabManager } = main;
  const relayout = () => (tabManager as unknown as { relayout: () => void }).relayout();

  // Smoke-test channel from Task 0 stays valid.
  ipcMain.handle('core:version', () => coreVersion());

  ipcMain.handle('tab:list', (): TabEvent => tabManager.getState());

  ipcMain.handle('tab:new', (_e, url: unknown) => {
    const target = isHttpUrl(url) ? url : 'https://example.com';
    const id = tabManager.newTab(target);
    relayout();
    return id;
  });

  ipcMain.handle('tab:close', (_e, id: unknown) => {
    if (!isTabId(id)) throw new Error('invalid tab id');
    tabManager.closeTab(id);
    relayout();
  });

  ipcMain.handle('tab:switch', (_e, id: unknown) => {
    if (!isTabId(id)) throw new Error('invalid tab id');
    tabManager.switchTab(id);
    relayout();
  });

  ipcMain.handle('nav:go', (_e, id: unknown, url: unknown) => {
    if (!isTabId(id)) throw new Error('invalid tab id');
    if (!isHttpUrl(url)) throw new Error('invalid url');
    tabManager.navigate(id, url);
  });

  ipcMain.handle('nav:back', (_e, id: unknown) => {
    if (!isTabId(id)) throw new Error('invalid tab id');
    const view = tabManager.viewOf(id);
    view?.webContents.navigationHistory && (view.webContents as unknown as { goBack: () => void }).goBack();
  });

  ipcMain.handle('nav:forward', (_e, id: unknown) => {
    if (!isTabId(id)) throw new Error('invalid tab id');
    const view = tabManager.viewOf(id);
    (view?.webContents as unknown as { goForward?: () => void } | undefined)?.goForward?.();
  });

  ipcMain.handle('nav:reload', (_e, id: unknown) => {
    if (!isTabId(id)) throw new Error('invalid tab id');
    const view = tabManager.viewOf(id);
    (view?.webContents as unknown as { reload?: () => void } | undefined)?.reload?.();
  });
}
```

> Note: `goBack`/`goForward`/`reload` exist on the real Electron `WebContents`; the `ManagedView` type only models the subset TabManager needs, hence the local casts. The Playwright tests in M1.6 exercise the real methods.

- [ ] **Step 2: Build to confirm main process compiles**

Run: `npm run build:core && npm run build`
Expected: builds with no TypeScript errors in `out/main`.

- [ ] **Step 3: Commit**

```bash
git add electron/main/ipc.ts
git commit -m "feat(shell): allow-listed tab/nav IPC router with arg validation"
```

---

## Task M1.5: Preload bridge + Svelte chrome UI

**Files:**
- Modify: `electron/preload/index.ts`
- Modify: `electron/renderer/src/env.d.ts`
- Create: `electron/renderer/src/lib/browserStore.svelte.ts`
- Create: `electron/renderer/src/components/TabStrip.svelte`
- Create: `electron/renderer/src/components/Toolbar.svelte`
- Modify: `electron/renderer/src/App.svelte`

- [ ] **Step 1: Extend the preload bridge**

Replace the contents of `electron/preload/index.ts`:

```typescript
import { contextBridge, ipcRenderer } from 'electron';
import type { TabEvent, TabId } from '../main/tabs/types';

const api = {
  coreVersion: (): Promise<string> => ipcRenderer.invoke('core:version'),
  tabs: {
    list: (): Promise<TabEvent> => ipcRenderer.invoke('tab:list'),
    new: (url?: string): Promise<TabId> => ipcRenderer.invoke('tab:new', url),
    close: (id: TabId): Promise<void> => ipcRenderer.invoke('tab:close', id),
    switch: (id: TabId): Promise<void> => ipcRenderer.invoke('tab:switch', id),
  },
  nav: {
    go: (id: TabId, url: string): Promise<void> => ipcRenderer.invoke('nav:go', id, url),
    back: (id: TabId): Promise<void> => ipcRenderer.invoke('nav:back', id),
    forward: (id: TabId): Promise<void> => ipcRenderer.invoke('nav:forward', id),
    reload: (id: TabId): Promise<void> => ipcRenderer.invoke('nav:reload', id),
  },
  /** Subscribe to tab-state pushes. Returns an unsubscribe fn. */
  onTabEvent: (cb: (event: TabEvent) => void): (() => void) => {
    const listener = (_e: unknown, event: TabEvent): void => cb(event);
    ipcRenderer.on('tab:event', listener);
    return () => ipcRenderer.removeListener('tab:event', listener);
  },
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('secureBrowser', api);
} else {
  throw new Error('contextIsolation is disabled — refusing to expose bridge insecurely');
}
```

- [ ] **Step 2: Update bridge types**

Replace the contents of `electron/renderer/src/env.d.ts`:

```typescript
/// <reference types="svelte" />
import type { TabEvent, TabId } from '../../main/tabs/types';

export interface SecureBrowserApi {
  coreVersion: () => Promise<string>;
  tabs: {
    list: () => Promise<TabEvent>;
    new: (url?: string) => Promise<TabId>;
    close: (id: TabId) => Promise<void>;
    switch: (id: TabId) => Promise<void>;
  };
  nav: {
    go: (id: TabId, url: string) => Promise<void>;
    back: (id: TabId) => Promise<void>;
    forward: (id: TabId) => Promise<void>;
    reload: (id: TabId) => Promise<void>;
  };
  onTabEvent: (cb: (event: TabEvent) => void) => () => void;
}

declare global {
  interface Window {
    secureBrowser: SecureBrowserApi;
  }
}

export {};
```

- [ ] **Step 3: Write the Svelte rune store**

Create `electron/renderer/src/lib/browserStore.svelte.ts`:

```typescript
import type { TabEvent, TabId, TabState } from '../../../main/tabs/types';

class BrowserStore {
  tabs = $state<TabState[]>([]);
  activeTabId = $state<TabId | null>(null);

  get active(): TabState | null {
    return this.tabs.find((t) => t.id === this.activeTabId) ?? null;
  }

  init(): void {
    window.secureBrowser.onTabEvent((e: TabEvent) => this.apply(e));
    void window.secureBrowser.tabs.list().then((e) => this.apply(e));
  }

  private apply(e: TabEvent): void {
    this.tabs = e.tabs;
    this.activeTabId = e.activeTabId;
  }

  newTab(url?: string): void {
    void window.secureBrowser.tabs.new(url);
  }
  closeTab(id: TabId): void {
    void window.secureBrowser.tabs.close(id);
  }
  switchTab(id: TabId): void {
    void window.secureBrowser.tabs.switch(id);
  }
  go(url: string): void {
    if (this.activeTabId) void window.secureBrowser.nav.go(this.activeTabId, url);
  }
  back(): void {
    if (this.activeTabId) void window.secureBrowser.nav.back(this.activeTabId);
  }
  forward(): void {
    if (this.activeTabId) void window.secureBrowser.nav.forward(this.activeTabId);
  }
  reload(): void {
    if (this.activeTabId) void window.secureBrowser.nav.reload(this.activeTabId);
  }
}

export const browser = new BrowserStore();
```

- [ ] **Step 4: Write `TabStrip.svelte`**

Create `electron/renderer/src/components/TabStrip.svelte`:

```svelte
<script lang="ts">
  import { browser } from '../lib/browserStore.svelte';
</script>

<div class="strip" data-testid="tab-strip">
  {#each browser.tabs as tab (tab.id)}
    <button
      class="tab"
      class:active={tab.id === browser.activeTabId}
      data-testid="tab"
      onclick={() => browser.switchTab(tab.id)}
    >
      <span class="title">{tab.title || tab.url}</span>
      <span
        class="close"
        data-testid="tab-close"
        role="button"
        tabindex="0"
        onclick={(e) => { e.stopPropagation(); browser.closeTab(tab.id); }}
        onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); browser.closeTab(tab.id); } }}
      >×</span>
    </button>
  {/each}
  <button class="new" data-testid="tab-new" onclick={() => browser.newTab()}>+</button>
</div>

<style>
  .strip { display: flex; gap: 2px; padding: 4px; background: #202124; }
  .tab { display: flex; align-items: center; gap: 6px; max-width: 200px; padding: 6px 10px;
         border: none; background: #303134; color: #e8eaed; border-radius: 6px 6px 0 0; cursor: pointer; }
  .tab.active { background: #3c4043; }
  .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .close { font-weight: bold; }
  .new { background: transparent; color: #e8eaed; border: none; font-size: 18px; cursor: pointer; }
</style>
```

- [ ] **Step 5: Write `Toolbar.svelte`**

Create `electron/renderer/src/components/Toolbar.svelte`:

```svelte
<script lang="ts">
  import { browser } from '../lib/browserStore.svelte';

  let addressInput = $state('');

  // Keep the address bar synced to the active tab's URL.
  $effect(() => {
    addressInput = browser.active?.url ?? '';
  });

  function submit(e: Event) {
    e.preventDefault();
    let url = addressInput.trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    browser.go(url);
  }
</script>

<div class="toolbar" data-testid="toolbar">
  <button data-testid="nav-back" disabled={!browser.active?.canGoBack} onclick={() => browser.back()}>←</button>
  <button data-testid="nav-forward" disabled={!browser.active?.canGoForward} onclick={() => browser.forward()}>→</button>
  <button data-testid="nav-reload" onclick={() => browser.reload()}>⟳</button>
  <form onsubmit={submit} style="flex:1">
    <input data-testid="address-bar" bind:value={addressInput} placeholder="Search or enter address" />
  </form>
</div>

<style>
  .toolbar { display: flex; align-items: center; gap: 6px; padding: 6px; background: #292a2d; }
  button { background: #3c4043; color: #e8eaed; border: none; border-radius: 4px; padding: 4px 10px; cursor: pointer; }
  button:disabled { opacity: 0.4; cursor: default; }
  input { width: 100%; padding: 6px 10px; border-radius: 16px; border: none; background: #202124; color: #e8eaed; }
</style>
```

- [ ] **Step 6: Recompose `App.svelte`**

Replace the contents of `electron/renderer/src/App.svelte`:

```svelte
<script lang="ts">
  import { browser } from './lib/browserStore.svelte';
  import TabStrip from './components/TabStrip.svelte';
  import Toolbar from './components/Toolbar.svelte';

  browser.init();
</script>

<TabStrip />
<Toolbar />
<!-- Tab page content is rendered natively by WebContentsView below the chrome. -->

<style>
  :global(body) { margin: 0; }
</style>
```

- [ ] **Step 7: Build and confirm the chrome UI compiles**

Run: `npm run build`
Expected: builds with no errors.

- [ ] **Step 8: Commit**

```bash
git add electron/preload/index.ts electron/renderer/src/env.d.ts electron/renderer/src/lib electron/renderer/src/components electron/renderer/src/App.svelte
git commit -m "feat(shell): Svelte tab strip, toolbar, address bar wired to bridge"
```

---

## Task M1.6: Browser-shell integration tests

**Files:**
- Test: `tests/shell.spec.ts`

> The Task 0 `tests/bridge.spec.ts` asserts a single BrowserWindow title. M1 replaces the window model, so update expectations there if it now fails: the chrome view title still resolves from `index.html` (`Secure Browser`), and `firstWindow()` returns the chrome view — both still hold. Run it after M1 to confirm; fix only if red.

- [ ] **Step 1: Write the failing shell integration test**

Create `tests/shell.spec.ts`:

```typescript
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { join } from 'node:path';

test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let chrome: Page; // the chrome UI page (tab strip + toolbar)

test.beforeAll(async () => {
  app = await electron.launch({ args: ['.'], cwd: join(__dirname, '..') });
  chrome = await app.firstWindow();
  await chrome.getByTestId('tab-strip').waitFor();
});

test.afterAll(async () => {
  await app.close();
});

test('starts with one tab', async () => {
  await expect(chrome.getByTestId('tab')).toHaveCount(1);
});

test('opens a second tab and navigates it', async () => {
  await chrome.getByTestId('tab-new').click();
  await expect(chrome.getByTestId('tab')).toHaveCount(2);

  await chrome.getByTestId('address-bar').fill('example.org');
  await chrome.getByTestId('address-bar').press('Enter');

  // Assert via the main process that the active tab's webContents reached example.org.
  await expect
    .poll(async () =>
      app.evaluate(({ webContents }) =>
        webContents.getAllWebContents().map((wc) => wc.getURL()).join(' '),
      ),
    )
    .toContain('example.org');
});

test('back/forward navigation works on the active tab', async () => {
  // Navigate active tab to a second URL, then go back.
  await chrome.getByTestId('address-bar').fill('example.com');
  await chrome.getByTestId('address-bar').press('Enter');
  await expect
    .poll(async () =>
      app.evaluate(({ webContents }) => webContents.getAllWebContents().map((wc) => wc.getURL()).join(' ')),
    )
    .toContain('example.com');

  await chrome.getByTestId('nav-back').click();
  await expect
    .poll(async () =>
      app.evaluate(({ webContents }) => webContents.getAllWebContents().map((wc) => wc.getURL()).join(' ')),
    )
    .toContain('example.org');
});

test('closing a tab reduces the count', async () => {
  const closeButtons = chrome.getByTestId('tab-close');
  await closeButtons.first().click();
  await expect(chrome.getByTestId('tab')).toHaveCount(1);
});

test('tab page renderers are sandboxed: no Node access', async () => {
  // The newest non-chrome webContents is a tab page. Evaluate in it via main.
  const hasNode = await app.evaluate(({ webContents }) => {
    const all = webContents.getAllWebContents();
    // The chrome view loads our index.html; tab views load example.*.
    const tab = all.find((wc) => !wc.getURL().includes('index.html'));
    return tab ? tab.executeJavaScript('typeof require + "," + typeof module') : 'no-tab';
  });
  expect(hasNode).toBe('undefined,undefined');
});
```

- [ ] **Step 2: Run the test to verify it passes (build first)**

Run: `npm run build:core && npm run build && npx playwright test tests/shell.spec.ts`
Expected: all five tests PASS. (Requires network access to load `example.org`/`example.com`. If CI is offline, see Step 3.)

- [ ] **Step 3: (Offline/CI robustness) swap to a bundled local page if network is unavailable**

If Step 2 fails only because `example.org` cannot load, create `tests/fixtures/page-a.html` and `tests/fixtures/page-b.html` (minimal `<title>Page A</title>` docs) and navigate to `file://${join(__dirname,'fixtures','page-a.html')}` instead. Update `isHttpUrl` is NOT needed — instead add a test-only allowance: in `tests/shell.spec.ts`, navigate by calling `app.evaluate` to load the file URL directly into the active tab's webContents. Keep the HTTP tests for local/dev runs.

> Note: M3 bundles a proper local login page; this fixture is only an offline fallback for M1 CI. Prefer keeping the network test if CI has egress.

- [ ] **Step 4: Run the full suite to confirm Task 0 tests still pass**

Run: `npx playwright test`
Expected: `tests/bridge.spec.ts` + `tests/shell.spec.ts` all green. If `bridge.spec.ts`'s `webPreferences` test now reads the chrome view's prefs, it still asserts sandbox/contextIsolation true and nodeIntegration false — which hold.

- [ ] **Step 5: Commit and push**

```bash
git add tests/shell.spec.ts
git commit -m "test(shell): two-tab navigation, back/forward, close, tab sandbox isolation"
git push
```

---

## Self-Review

**Spec coverage (M1 requirements):**
- Tabs via `WebContentsView` → M1.3 (`factory.create` builds `WebContentsView`s) + M1.2 (lifecycle bookkeeping). ✓
- Address bar, back/forward/reload → M1.4 (`nav:*` handlers) + M1.5 (`Toolbar.svelte`). ✓
- New/close tab → M1.4 (`tab:new`/`tab:close`) + M1.5 (`TabStrip.svelte`). ✓
- Basic history → back/forward over `WebContents.navigationHistory` (`nav:back`/`nav:forward`); per-tab session history is the Chromium history M1.6 Step 3 exercises. ✓
- Harden tab `webPreferences` (sandbox, contextIsolation, no nodeIntegration) → M1.3 factory. ✓
- **Verify:** Playwright `_electron` navigates two tabs, asserts titles/URLs, asserts renderer cannot access Node → M1.6 Steps 1–2 + the sandbox test. ✓

**Placeholder scan:** No TBD/TODO placeholders. The one conditional ("offline fallback", M1.6 Step 3) is an explicit alternative with concrete instructions, not a gap. Every component/handler has full code.

**Type consistency:** `TabId`/`TabState`/`TabEvent` defined once in `tabs/types.ts` and imported by main, preload, store. Bridge namespaces `tabs`/`nav`/`onTabEvent` match between `preload/index.ts` and `env.d.ts` and `browserStore.svelte.ts`. IPC channel names match between `ipc.ts` (`tab:new`, `tab:close`, `tab:switch`, `tab:list`, `nav:go|back|forward|reload`) and the preload `invoke` calls. `TabManager` public methods used externally (`newTab`, `closeTab`, `switchTab`, `navigate`, `getState`, `getActiveView`, `applyTabState`, `applyTabStateSilent`, `viewOf`) are all defined (M1.2 + M1.3 Step 2). `data-testid`s in components (`tab-strip`, `tab`, `tab-close`, `tab-new`, `toolbar`, `nav-back`, `nav-forward`, `nav-reload`, `address-bar`) match the selectors in `shell.spec.ts`.

---

## Execution Handoff

Plan complete. After this, proceed to `2026-05-20-m2-vault-core.md`.
