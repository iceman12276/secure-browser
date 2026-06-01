<script lang="ts">
  import { browser } from '../lib/browserStore.svelte';
  import { resolveOmnibox } from '../lib/omnibox';

  let addressInput = $state('');
  let focused = $state(false);

  // Keep the address bar synced to the active tab's URL, but never while the
  // user is typing — tab:event fires several times per page load.
  $effect(() => {
    const url = browser.active?.url ?? '';
    if (!focused) addressInput = url;
  });

  function submit(e: Event) {
    e.preventDefault();
    const url = resolveOmnibox(addressInput);
    if (url) browser.go(url);
  }
</script>

<div class="toolbar" data-testid="toolbar">
  <button class="nav" data-testid="nav-back" disabled={!browser.active?.canGoBack} onclick={() => browser.back()} aria-label="Back">←</button>
  <button class="nav" data-testid="nav-forward" disabled={!browser.active?.canGoForward} onclick={() => browser.forward()} aria-label="Forward">→</button>
  <button class="nav" data-testid="nav-reload" onclick={() => browser.reload()} aria-label="Reload">⟳</button>
  <form onsubmit={submit}>
    <input data-testid="address-bar" bind:value={addressInput} onfocus={() => (focused = true)} onblur={() => (focused = false)} placeholder="Search the web or type an address" spellcheck="false" />
  </form>
</div>

<style>
  .toolbar {
    display: flex; align-items: center; gap: 6px;
    height: 44px; box-sizing: border-box; padding: 0 12px;
    background: var(--chrome); border-bottom: 1px solid var(--border);
  }
  .nav {
    flex: 0 0 auto; width: 30px; height: 30px; border: none; border-radius: 8px;
    background: transparent; color: var(--text-dim); cursor: pointer;
    display: flex; align-items: center; justify-content: center; font-size: 15px;
    transition: background .12s, color .12s;
  }
  .nav:hover:not(:disabled) { background: var(--chrome-hi); color: var(--text); }
  .nav:disabled { opacity: .4; cursor: default; color: var(--text-faint); }
  form { flex: 1 1 auto; display: flex; }
  input {
    width: 100%; height: 34px; box-sizing: border-box; padding: 0 14px;
    border: 1px solid transparent; border-radius: 18px;
    background: var(--chrome-hi); color: var(--text); font-size: 13px;
    font-family: inherit; outline: none; transition: border-color .15s, box-shadow .15s;
  }
  input::placeholder { color: var(--text-dim); }
  input:focus { border-color: var(--accent-ring); box-shadow: 0 0 0 3px var(--accent-soft); }
</style>
