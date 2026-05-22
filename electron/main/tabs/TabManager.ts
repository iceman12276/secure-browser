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

  /** Pull current nav flags (canGoBack/canGoForward) off the live webContents into state. */
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

  /** Like applyTabState but does NOT emit (avoids recursion during broadcast). */
  applyTabStateSilent(id: TabId, patch: Partial<TabState>): void {
    const tab = this.find(id);
    if (tab) Object.assign(tab.state, patch);
  }

  /** Expose the underlying view for the window layer (typed loosely on purpose). */
  viewOf(id: TabId): ManagedView | null {
    return this.find(id)?.view ?? null;
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
