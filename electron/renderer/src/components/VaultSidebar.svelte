<script lang="ts">
  import { vaultStore } from '../lib/vaultStore.svelte';

  let pw = $state('');
  let origin = $state('');
  let username = $state('');
  let secret = $state('');
  let label = $state('');
  let revealed = $state<Record<string, string>>({});

  void vaultStore.refreshStatus();

  async function reveal(id: string) {
    revealed = { ...revealed, [id]: await vaultStore.reveal(id) };
  }
  async function addCredential() {
    await vaultStore.add(origin, username, secret, label);
    origin = username = secret = label = '';
  }
</script>

<aside class="sidebar" data-testid="vault-sidebar">
  {#if vaultStore.error}
    <p class="error" data-testid="vault-error">{vaultStore.error}</p>
  {/if}

  {#if !vaultStore.unlocked}
    <form onsubmit={(e) => { e.preventDefault(); vaultStore.initialized ? vaultStore.unlock(pw) : vaultStore.init(pw); }}>
      <h2>{vaultStore.initialized ? 'Unlock vault' : 'Create vault'}</h2>
      <input type="password" data-testid="master-pw" aria-label="Master password" bind:value={pw} placeholder="Master password" />
      <button data-testid="vault-submit">{vaultStore.initialized ? 'Unlock' : 'Create'}</button>
    </form>
  {:else}
    <header>
      <h2>Vault</h2>
      <button class="secondary" data-testid="vault-lock" onclick={() => vaultStore.lock()}>Lock</button>
    </header>

    <form onsubmit={(e) => { e.preventDefault(); addCredential(); }} data-testid="add-form">
      <input data-testid="add-origin" aria-label="Origin" bind:value={origin} placeholder="https://site.com" />
      <input data-testid="add-username" aria-label="Username" bind:value={username} placeholder="Username" />
      <input data-testid="add-secret" type="password" aria-label="Password" bind:value={secret} placeholder="Password" />
      <input data-testid="add-label" aria-label="Label" bind:value={label} placeholder="Label (optional)" />
      <button data-testid="add-submit">Add</button>
    </form>

    <ul data-testid="cred-list">
      {#each vaultStore.credentials as c (c.id)}
        <li data-testid="cred-item">
          <strong>{c.label || c.origin}</strong>
          <span data-testid="cred-username">{c.username}</span>
          {#if revealed[c.id]}
            <code data-testid="cred-secret">{revealed[c.id]}</code>
          {:else}
            <button class="secondary" data-testid="cred-reveal" onclick={() => reveal(c.id)}>Reveal</button>
          {/if}
          <button class="delete" data-testid="cred-delete" onclick={() => vaultStore.remove(c.id)}>Delete</button>
        </li>
      {/each}
    </ul>
  {/if}
</aside>

<style>
  .sidebar {
    position: fixed; right: 0; top: 88px; bottom: 0; width: 320px;
    box-sizing: border-box;
    background: var(--panel); color: var(--text);
    border-left: 1px solid var(--border);
    padding: 16px; overflow-y: auto; font-family: inherit;
  }

  h2 {
    margin: 0 0 10px;
    color: var(--text); font-size: 15px; font-weight: 600;
  }

  header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 12px;
  }
  header h2 { margin: 0; }

  .error {
    color: var(--danger); font-size: 13px; margin: 0 0 8px;
  }

  input {
    width: 100%; box-sizing: border-box; margin: 6px 0; padding: 8px 10px;
    background: var(--chrome-hi); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px;
    outline: none; font: inherit;
    transition: border-color .15s, box-shadow .15s;
  }
  input::placeholder { color: var(--text-faint); }
  input:focus { border-color: var(--accent-ring); box-shadow: 0 0 0 3px var(--accent-soft); }

  button {
    background: var(--accent); color: #0b1220; border: none; border-radius: 8px;
    padding: 8px 12px; font-weight: 600; cursor: pointer; font: inherit;
    transition: filter .12s, color .12s, border-color .12s;
  }
  button:hover { filter: brightness(1.08); }

  .secondary {
    background: var(--chrome-hi); color: var(--text-dim);
    border: 1px solid var(--border); border-radius: 8px;
    padding: 6px 10px; font-weight: 400; cursor: pointer;
  }
  .secondary:hover { filter: none; color: var(--text); }

  .delete {
    color: var(--danger); background: transparent;
    border: 1px solid var(--border); border-radius: 8px;
    font-weight: 400; cursor: pointer;
  }
  .delete:hover { filter: none; border-color: var(--danger); }

  ul {
    list-style: none; padding: 0; margin: 8px 0 0;
  }
  li {
    background: var(--panel-hi); border: 1px solid var(--border); border-radius: 10px;
    padding: 10px; margin: 8px 0;
    display: flex; flex-direction: column; gap: 4px;
  }
  li span { color: var(--text-dim); font-size: 13px; }
  code {
    font-family: ui-monospace, monospace;
    background: var(--bg); color: var(--accent);
    padding: 4px 6px; border-radius: 6px; word-break: break-all;
  }

  button:focus-visible, input:focus-visible {
    outline: 2px solid var(--accent-ring); outline-offset: 2px;
  }
</style>
