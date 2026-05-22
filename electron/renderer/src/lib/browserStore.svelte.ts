import type { TabEvent, TabId, TabState } from '../../../main/tabs/types';

class BrowserStore {
  tabs = $state<TabState[]>([]);
  activeTabId = $state<TabId | null>(null);

  get active(): TabState | null {
    return this.tabs.find((t) => t.id === this.activeTabId) ?? null;
  }

  // Called once for the app-root singleton's lifetime; intentionally not torn down.
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
