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
