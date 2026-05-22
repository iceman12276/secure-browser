import { describe, it, expect, vi } from 'vitest';
import { TabManager } from '../../electron/main/tabs/TabManager';

/**
 * A fake tab view standing in for an Electron WebContentsView.
 * `nav` lets a test configure what navigationHistory reports so refresh() can be asserted.
 */
function fakeViewFactory(nav: { canGoBack?: boolean; canGoForward?: boolean } = {}) {
  return {
    create: vi.fn(() => ({
      webContents: {
        loadURL: vi.fn(),
        on: vi.fn(),
        destroy: vi.fn(),
        navigationHistory: {
          canGoBack: () => nav.canGoBack ?? false,
          canGoForward: () => nav.canGoForward ?? false,
        },
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

  it('emits a TabEvent payload carrying tabs and activeTabId', () => {
    const onChange = vi.fn();
    const tm = new TabManager(fakeViewFactory() as never, onChange);
    const a = tm.newTab('https://a.com');
    const event = onChange.mock.calls.at(-1)![0];
    expect(event.activeTabId).toBe(a);
    expect(event.tabs).toHaveLength(1);
    expect(event.tabs[0]).toMatchObject({ id: a, url: 'https://a.com', loading: true });
  });
});

describe('TabManager mutators', () => {
  it('navigate sets url + loading and calls loadURL', () => {
    const factory = fakeViewFactory();
    const tm = new TabManager(factory as never, () => {});
    const id = tm.newTab('https://a.com');
    const view = factory.create.mock.results.at(-1)!.value;
    view.webContents.loadURL.mockClear();

    tm.navigate(id, 'https://b.com');

    const tab = tm.getState().tabs[0];
    expect(tab.url).toBe('https://b.com');
    expect(tab.loading).toBe(true);
    expect(view.webContents.loadURL).toHaveBeenCalledWith('https://b.com');
  });

  it('navigate is a no-op for an unknown tab id', () => {
    const tm = new TabManager(fakeViewFactory() as never, () => {});
    tm.newTab('https://a.com');
    expect(() => tm.navigate('tab-999', 'https://x.com')).not.toThrow();
    expect(tm.getState().tabs[0].url).toBe('https://a.com');
  });

  it('refresh pulls canGoBack/canGoForward from navigationHistory into state', () => {
    const tm = new TabManager(
      fakeViewFactory({ canGoBack: true, canGoForward: true }) as never,
      () => {},
    );
    const id = tm.newTab('https://a.com');
    expect(tm.getState().tabs[0].canGoBack).toBe(false);
    expect(tm.getState().tabs[0].canGoForward).toBe(false);

    tm.refresh(id);

    expect(tm.getState().tabs[0].canGoBack).toBe(true);
    expect(tm.getState().tabs[0].canGoForward).toBe(true);
  });

  it('applyTabState merges the patch and emits', () => {
    const onChange = vi.fn();
    const tm = new TabManager(fakeViewFactory() as never, onChange);
    const id = tm.newTab('https://a.com');
    onChange.mockClear();

    tm.applyTabState(id, { title: 'Hello', loading: false });

    const tab = tm.getState().tabs[0];
    expect(tab.title).toBe('Hello');
    expect(tab.loading).toBe(false);
    expect(tab.url).toBe('https://a.com');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('getActiveView returns the active tab view, and null when no tabs', () => {
    const factory = fakeViewFactory();
    const tm = new TabManager(factory as never, () => {});
    expect(tm.getActiveView()).toBeNull();

    const id = tm.newTab('https://a.com');
    const view = factory.create.mock.results.at(-1)!.value;
    expect(tm.getActiveView()).toBe(view);

    tm.closeTab(id);
    expect(tm.getActiveView()).toBeNull();
  });
});
