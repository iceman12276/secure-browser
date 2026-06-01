<script lang="ts">
  import { browser } from '../lib/browserStore.svelte';
</script>

<div class="strip" data-testid="tab-strip">
  {#each browser.tabs as tab (tab.id)}
    <div
      class="tab"
      class:active={tab.id === browser.activeTabId}
      data-testid="tab"
      role="button"
      tabindex="0"
      onclick={() => browser.switchTab(tab.id)}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); browser.switchTab(tab.id); } }}
    >
      <span class="title">{tab.title || tab.url}</span>
      <button
        class="close"
        data-testid="tab-close"
        aria-label="Close tab"
        onclick={(e) => { e.stopPropagation(); browser.closeTab(tab.id); }}
      >×</button>
    </div>
  {/each}
  <button class="new" data-testid="tab-new" onclick={() => browser.newTab()}>+</button>
</div>

<style>
  .strip {
    display: flex; align-items: flex-end; gap: 2px;
    height: 44px; box-sizing: border-box; padding: 6px 8px 0;
    background: var(--chrome); border-bottom: 1px solid var(--border);
  }
  .tab {
    display: flex; align-items: center; gap: 8px;
    min-width: 60px; max-width: 220px; flex: 1 1 200px;
    padding: 7px 12px; border: none; cursor: default;
    background: transparent; color: var(--text-dim);
    border-radius: 10px 10px 0 0; font-size: 12.5px;
    transition: background .12s, color .12s;
  }
  .tab:hover { background: var(--chrome-hi); }
  .tab.active { background: var(--tab-active); color: var(--text); font-weight: 500; }
  .title { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .close {
    position: relative;
    flex: 0 0 auto; width: 18px; height: 18px; display: flex;
    align-items: center; justify-content: center; border-radius: 5px;
    border: none; background: transparent; cursor: pointer; padding: 0;
    color: var(--text-dim); font-size: 14px;
  }
  /* Keep the glyph a tasteful 18px but expand the clickable target to 28px
     (>= WCAG 2.2 AA 2.5.8 minimum of 24px) via a transparent inset overlay. */
  .close::before {
    content: ''; position: absolute;
    top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 28px; height: 28px;
  }
  .close:hover { background: var(--border-strong); color: var(--text); }
  .new {
    flex: 0 0 auto; align-self: center; width: 28px; height: 28px; margin-left: 4px;
    border: none; background: transparent; color: var(--text-dim);
    border-radius: 8px; font-size: 18px; line-height: 1; cursor: pointer;
  }
  .new:hover { background: var(--chrome-hi); color: var(--text); }
</style>
