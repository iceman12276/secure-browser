<script lang="ts">
  import { vaultStore } from '../lib/vaultStore.svelte';
  import MfaEnroll from './MfaEnroll.svelte';
  import MfaPrompt from './MfaPrompt.svelte';

  let pw = $state('');
  let origin = $state('');
  let username = $state('');
  let secret = $state('');
  let label = $state('');
  let revealed = $state<Record<string, string>>({});

  vaultStore.initAutoLock();

  // Clear revealed plaintext whenever the vault locks (manual or auto-lock).
  $effect(() => { if (!vaultStore.unlocked) revealed = {}; });

  vaultStore.refreshStatus().catch((e) => {
    vaultStore.error = e instanceof Error ? e.message : String(e);
  });

  async function submitMaster() {
    await (vaultStore.initialized ? vaultStore.unlock(pw) : vaultStore.init(pw));
    if (vaultStore.unlocked) pw = ''; // clear master password from memory on success
  }
  async function reveal(id: string) {
    try {
      revealed = { ...revealed, [id]: await vaultStore.reveal(id) };
    } catch (e) {
      // Surface a failed reveal — never silently swallow (capstone lesson).
      vaultStore.error = e instanceof Error ? e.message : String(e);
    }
  }
  async function lockVault() {
    await vaultStore.lock();
    revealed = {}; // drop revealed plaintext from memory on lock
  }
  async function addCredential() {
    await vaultStore.add(origin, username, secret, label);
    origin = username = secret = label = '';
  }
</script>

<aside class="sidebar" data-testid="vault-sidebar">
  {#if vaultStore.error && !vaultStore.awaitingSecondFactor}
    <p class="error" data-testid="vault-error">{vaultStore.error}</p>
  {/if}
  {#if vaultStore.notice}
    <p class="notice" data-testid="vault-notice" role="status" aria-live="polite">
      <span class="check" aria-hidden="true">✓</span>{vaultStore.notice}
    </p>
  {/if}

  {#if vaultStore.awaitingSecondFactor}
    <MfaPrompt />
  {:else if !vaultStore.unlocked}
    <form onsubmit={(e) => { e.preventDefault(); submitMaster(); }}>
      <h2>{vaultStore.initialized ? 'Unlock vault' : 'Create vault'}</h2>
      <input type="password" data-testid="master-pw" aria-label="Master password" bind:value={pw} placeholder="Master password" />
      <button data-testid="vault-submit">{vaultStore.initialized ? 'Unlock' : 'Create'}</button>
      {#if !vaultStore.initialized}
        <p class="reassure">
          <svg class="reassure-icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
            <path d="M12 2.6 5 5.3v5.2c0 4.1 2.9 7.9 7 9 4.1-1.1 7-4.9 7-9V5.3L12 2.6Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
            <path d="m8.7 12 2.2 2.2 4.3-4.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Your passwords are encrypted and stay on this device. Nothing is sent to the cloud.
        </p>
        <p class="reassure-note">Your master password is the only key to your vault. There's no way to recover it, so choose something you'll remember.</p>
      {/if}
    </form>
  {:else}
    <header>
      <h2>Vault</h2>
      <button class="secondary" data-testid="vault-lock" onclick={() => lockVault()}>Lock</button>
    </header>

    <form onsubmit={(e) => { e.preventDefault(); addCredential(); }} data-testid="add-form">
      <input data-testid="add-origin" aria-label="Website address" bind:value={origin} placeholder="https://example.com" />
      <input data-testid="add-username" aria-label="Username" bind:value={username} placeholder="Username" />
      <input data-testid="add-secret" type="password" aria-label="Password for this site" bind:value={secret} placeholder="Password" />
      <input data-testid="add-label" aria-label="Label" bind:value={label} placeholder="Label (optional)" />
      <button data-testid="add-submit">Add password</button>
    </form>

    <ul data-testid="cred-list">
      {#each vaultStore.credentials as c (c.id)}
        <li data-testid="cred-item">
          <strong>{c.label || c.origin}</strong>
          <span data-testid="cred-username">{c.username}</span>
          {#if revealed[c.id]}
            <code data-testid="cred-secret">{revealed[c.id]}</code>
          {:else}
            <button class="secondary" data-testid="cred-reveal" onclick={() => reveal(c.id)}>Show password</button>
          {/if}
          <button class="delete" data-testid="cred-delete" onclick={() => vaultStore.remove(c.id)}>Delete</button>
        </li>
      {/each}
    </ul>
    {#if vaultStore.credentials.length === 0}
      <div class="empty" role="note">
        <svg class="empty-icon" viewBox="0 0 24 24" width="40" height="40" aria-hidden="true" focusable="false">
          <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.5" />
          <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          <circle cx="12" cy="15" r="1.5" fill="currentColor" />
        </svg>
        <p class="empty-title">No saved passwords yet</p>
        <p class="empty-body">Add one above, or sign in to a site and we'll offer to save it for you.</p>
      </div>
    {/if}
    <MfaEnroll />
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

  .notice {
    color: var(--success); font-size: 13px; margin: 0 0 8px;
    display: flex; align-items: center; gap: 8px;
  }
  .notice .check {
    flex: none;
    display: inline-flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; border-radius: 50%;
    background: var(--success); color: var(--bg); font-weight: 700; font-size: 13px;
    /* ease-out-quint, no overshoot: a gentle settle, never a bounce. */
    animation: notice-pop 0.28s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  @keyframes notice-pop {
    0% { transform: scale(0.6); opacity: 0; }
    100% { transform: scale(1); opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .notice .check { animation: none; }
  }

  input {
    width: 100%; box-sizing: border-box; margin: 6px 0; padding: 8px 10px;
    background: var(--chrome-hi); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px;
    outline: none; font: inherit;
    transition: border-color .15s, box-shadow .15s;
  }
  input::placeholder { color: var(--text-dim); }
  input:focus { border-color: var(--accent-ring); box-shadow: 0 0 0 3px var(--accent-soft); }

  button {
    background: var(--accent); color: var(--bg); border: none; border-radius: 8px;
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

  .reassure {
    display: flex; align-items: flex-start; gap: 8px;
    margin: 14px 0 0; padding: 0;
    color: var(--text-dim); font-size: 12.5px; line-height: 1.45;
  }
  .reassure-icon { flex: none; margin-top: 1px; color: var(--success); }
  .reassure-note {
    margin: 8px 0 0; padding: 0;
    color: var(--text-dim); font-size: 12px; line-height: 1.45;
  }

  .empty {
    display: flex; flex-direction: column; align-items: center; text-align: center;
    gap: 6px; margin: 18px 4px 4px; padding: 22px 14px;
    border: 1px dashed var(--border-strong); border-radius: 12px;
    background: var(--panel-hi);
    animation: empty-in .4s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  .empty-icon { color: var(--text-faint); margin-bottom: 2px; }
  .empty-title { margin: 0; color: var(--text); font-size: 13.5px; font-weight: 600; }
  .empty-body { margin: 0; color: var(--text-dim); font-size: 12.5px; line-height: 1.45; }
  @keyframes empty-in {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .empty { animation: none; }
  }

  button:focus-visible, input:focus-visible {
    outline: 2px solid var(--accent-ring); outline-offset: 2px;
  }
</style>
