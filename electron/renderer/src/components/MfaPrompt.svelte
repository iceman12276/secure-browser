<script lang="ts">
  import { vaultStore } from '../lib/vaultStore.svelte';
  import WebauthnBusy from './WebauthnBusy.svelte';
  let code = $state('');
</script>

<section data-testid="mfa-prompt">
  <h2>Second factor</h2>

  {#if vaultStore.totpEnrolled}
    <form onsubmit={(e) => { e.preventDefault(); vaultStore.verifyTotp(code); }}>
      <p>Enter your authenticator code</p>
      <input data-testid="totp-code" inputmode="numeric" bind:value={code} placeholder="123456" />
      <button data-testid="totp-verify">Verify</button>
    </form>
  {/if}

  {#if vaultStore.totpEnrolled && vaultStore.hasPasskey}
    <p class="divider">or</p>
  {/if}

  <!-- Security-key unlock: drives the native CTAP2 ceremony in the Rust core (USB HID) via the vault store.
       Hardware-dependent path, validated manually (tests/manual/webauthn-hardware-ceremony.md).
       Shown only when a passkey is registered, so TOTP-only users don't hit a
       "no passkeys registered" error. -->
  {#if vaultStore.hasPasskey}
    <button
      type="button"
      class="secondary"
      data-testid="webauthn-unlock"
      onclick={() => vaultStore.authenticateWebauthn()}
      disabled={vaultStore.webauthnBusy}
    >
      Unlock with security key
    </button>
    {#if vaultStore.webauthnBusy}<WebauthnBusy />{/if}
  {/if}
</section>

<style>
  /* Scoped to this component (Svelte) — the second-factor gate is seen on every
     unlock, so its controls must match the Aurora sidebar, not fall back to
     unstyled UA defaults. Mirrors VaultSidebar's input/button treatment. */
  h2 { margin: 0 0 10px; color: var(--text); font-size: 15px; font-weight: 600; }
  p { color: var(--text-dim); font-size: 13px; margin: 0 0 6px; }
  .divider { color: var(--text-faint); margin: 10px 0; text-align: center; }

  input {
    width: 100%; box-sizing: border-box; margin: 8px 0; padding: 8px 10px;
    background: var(--chrome-hi); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px;
    outline: none; font: inherit;
    transition: border-color .15s, box-shadow .15s;
  }
  input::placeholder { color: var(--text-faint); }
  input:focus { border-color: var(--accent-ring); box-shadow: 0 0 0 3px var(--accent-soft); }

  button {
    display: block; margin: 8px 0 0;
    background: var(--accent); color: #0b1220; border: none; border-radius: 8px;
    padding: 8px 12px; font-weight: 600; cursor: pointer; font: inherit;
    transition: filter .12s, color .12s;
  }
  button:hover { filter: brightness(1.08); }
  button:disabled { opacity: .55; cursor: default; filter: none; }

  .secondary {
    background: var(--chrome-hi); color: var(--text-dim);
    border: 1px solid var(--border); font-weight: 400;
  }
  .secondary:hover { filter: none; color: var(--text); }

  button:focus-visible, input:focus-visible {
    outline: 2px solid var(--accent-ring); outline-offset: 2px;
  }
</style>
