<script lang="ts">
  import { vaultStore } from '../lib/vaultStore.svelte';

  let prompt = $state<{ origin: string; username: string; secret: string } | null>(null);

  window.secureBrowser.onSavePrompt((p) => (prompt = p));

  async function save() {
    if (!prompt) return;
    await window.secureBrowser.vault.saveFromPrompt(prompt);
    prompt = null;
    await vaultStore.refreshList();
  }
  function dismiss() {
    prompt = null;
  }
</script>

{#if prompt}
  <div class="save-prompt" data-testid="save-prompt">
    <span>Save password for <strong>{prompt.username || prompt.origin}</strong>?</span>
    <button data-testid="save-accept" onclick={save}>Save</button>
    <button class="secondary" data-testid="save-dismiss" onclick={dismiss}>Not now</button>
  </div>
{/if}

<style>
  .save-prompt {
    position: fixed;
    top: 92px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--border);
    padding: 10px 14px;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
    display: flex;
    gap: 10px;
    align-items: center;
    z-index: 1000;
    font: inherit;
  }

  button {
    background: var(--accent);
    color: #0b1220;
    border: none;
    border-radius: 8px;
    padding: 6px 12px;
    font-weight: 600;
    cursor: pointer;
    font: inherit;
    transition: filter 0.12s;
  }
  button:hover { filter: brightness(1.08); }

  .secondary {
    background: var(--chrome-hi);
    color: var(--text-dim);
    border: 1px solid var(--border);
    font-weight: 400;
  }
  .secondary:hover { filter: none; color: var(--text); }

  button:focus-visible {
    outline: 2px solid var(--accent-ring);
    outline-offset: 2px;
  }
</style>
