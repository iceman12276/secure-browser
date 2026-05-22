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
