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
    <button data-testid="webauthn-register" onclick={registerKey} disabled={vaultStore.webauthnBusy}>
      {vaultStore.hasPasskey ? 'Register another security key / passkey' : 'Register security key / passkey'}
    </button>
    {#if vaultStore.webauthnBusy}<WebauthnBusy />{/if}
    {#if error}<p class="error">{error}</p>{/if}
  {/if}
</section>

<style>
  .mfa-enroll { border-top: 1px solid #444; margin-top: 12px; padding-top: 12px; }
  .error { color: #f28b82; }
  img { width: 160px; height: 160px; }
</style>
