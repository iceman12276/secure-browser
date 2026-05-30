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
  .divider { color: #888; margin: 8px 0; text-align: center; }
</style>
