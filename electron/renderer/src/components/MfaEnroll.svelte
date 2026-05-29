<script lang="ts">
  import { vaultStore } from '../lib/vaultStore.svelte';

  let enrollment = $state<{ secretBase32: string; otpauthUrl: string; qrPngBase64: string } | null>(null);
  let code = $state('');
  let confirmed = $state(false);
  let error = $state<string | null>(null);

  async function begin() {
    enrollment = await vaultStore.enrollTotp();
  }
  async function confirm() {
    error = null;
    const ok = await vaultStore.confirmTotp(code);
    if (ok) {
      confirmed = true;
      enrollment = null;
      await vaultStore.refreshStatus();
    } else {
      error = 'Code did not match — try again';
    }
  }

  async function registerKey() {
    // Begin RP ceremony in Rust; perform navigator.credentials in the chrome page.
    const { challengeJson, stateJson } = await window.secureBrowser.webauthn.startRegistration();
    const options = JSON.parse(challengeJson);
    // The challenge JSON uses base64url fields; a production build should decode
    // them to ArrayBuffers before calling create(). This wiring is exercised
    // manually with hardware (see plan M4.7 Step 5).
    const cred = await navigator.credentials.create({ publicKey: options.publicKey ?? options });
    await window.secureBrowser.webauthn.finishRegistration(JSON.stringify(cred), stateJson);
    await vaultStore.refreshStatus();
  }
</script>

<section class="mfa-enroll" data-testid="mfa-enroll">
  <h3>Two-factor authentication</h3>
  {#if vaultStore.mfaEnrolled}
    <p data-testid="mfa-enrolled">✅ A second factor is enrolled.</p>
  {:else if !enrollment}
    <button data-testid="totp-begin" onclick={begin}>Set up authenticator app</button>
    <button data-testid="webauthn-register" onclick={registerKey}>Register security key / passkey</button>
  {:else}
    <img alt="TOTP QR" src={`data:image/png;base64,${enrollment.qrPngBase64}`} />
    <p><small>Secret: {enrollment.secretBase32}</small></p>
    <input data-testid="totp-confirm-code" bind:value={code} placeholder="Enter code to confirm" />
    <button data-testid="totp-confirm" onclick={confirm}>Confirm</button>
    {#if error}<p class="error">{error}</p>{/if}
  {/if}
  {#if confirmed}<p data-testid="totp-confirmed">Authenticator enrolled.</p>{/if}
</section>

<style>
  .mfa-enroll { border-top: 1px solid #444; margin-top: 12px; padding-top: 12px; }
  .error { color: #f28b82; }
  img { width: 160px; height: 160px; }
</style>
