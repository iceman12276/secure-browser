<script lang="ts">
  import { vaultStore } from '../lib/vaultStore.svelte';
  import WebauthnBusy from './WebauthnBusy.svelte';

  let enrollment = $state<{ secretBase32: string; otpauthUrl: string; qrPngBase64: string } | null>(null);
  let code = $state('');
  let error = $state<string | null>(null);

  async function begin() {
    error = null;
    try {
      enrollment = await vaultStore.enrollTotp();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  async function confirm() {
    error = null;
    try {
      const ok = await vaultStore.confirmTotp(code);
      if (ok) {
        enrollment = null;
        await vaultStore.refreshStatus();
      } else {
        error = 'Code did not match — try again';
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  // The register/unlock security-key ceremony (native CTAP2 client in the core)
  // lives in lib/webauthn.ts (driven via the vault store). It is hardware-dependent and validated
  // manually (tests/manual/webauthn-hardware-ceremony.md), not in CI. Failures
  // surface via the shared vault-error banner in VaultSidebar.
  async function registerKey() {
    await vaultStore.registerWebauthn();
  }
</script>

<section class="mfa-enroll" data-testid="mfa-enroll">
  <h3>Two-factor authentication</h3>
  {#if enrollment}
    <img alt="TOTP QR" src={`data:image/png;base64,${enrollment.qrPngBase64}`} />
    <p><small>Secret: {enrollment.secretBase32}</small></p>
    <input data-testid="totp-confirm-code" bind:value={code} placeholder="Enter code to confirm" />
    <button data-testid="totp-confirm" onclick={confirm}>Confirm</button>
    {#if error}<p class="error">{error}</p>{/if}
  {:else}
    <!-- Factors are composable: TOTP and any number of security keys can be added
         independently. The register button must stay reachable even once a factor
         exists (otherwise an existing vault could never add a key). -->
    {#if vaultStore.mfaEnrolled}
      <p data-testid="mfa-enrolled">✅ A second factor is enrolled.</p>
    {/if}
    {#if !vaultStore.totpEnrolled}
      <button data-testid="totp-begin" onclick={begin}>Set up authenticator app</button>
    {/if}
    <button class="secondary" data-testid="webauthn-register" onclick={registerKey} disabled={vaultStore.webauthnBusy}>
      {vaultStore.hasPasskey ? 'Register another security key / passkey' : 'Register security key / passkey'}
    </button>
    {#if vaultStore.webauthnBusy}<WebauthnBusy />{/if}
    {#if error}<p class="error">{error}</p>{/if}
  {/if}
</section>

<style>
  /* Scoped to this component (Svelte) — mirror VaultSidebar's Aurora control
     styling so the enroll inputs/buttons match the rest of the sidebar instead
     of falling back to unstyled UA defaults. */
  .mfa-enroll { border-top: 1px solid var(--border); margin-top: 12px; padding-top: 12px; }
  h3 { margin: 0 0 10px; color: var(--text); font-size: 14px; font-weight: 600; }
  p { color: var(--text); font-size: 13px; margin: 8px 0; }
  small { color: var(--text-dim); word-break: break-all; }
  .error { color: var(--danger); font-size: 13px; }
  img { width: 160px; height: 160px; border-radius: 8px; display: block; background: #fff; padding: 6px; box-sizing: border-box; }

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
