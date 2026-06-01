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
        error = 'Code did not match. Try again.';
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
  <p class="explainer">Add a second step when unlocking, so your password alone isn't enough to open your vault. Use a free authenticator app on your phone, a security key, or both.</p>
  {#if enrollment}
    <p class="step">Open your authenticator app (like Google Authenticator, Authy, or 1Password) and scan this code.</p>
    <img alt="QR code for your authenticator app" src={`data:image/png;base64,${enrollment.qrPngBase64}`} />
    <p class="manual-label">Can't scan it? Enter this setup key in your app instead:</p>
    <code class="setup-key" data-testid="totp-secret">{enrollment.secretBase32}</code>
    <input data-testid="totp-confirm-code" inputmode="numeric" aria-label="Code from your authenticator app" bind:value={code} placeholder="Enter the 6-digit code" />
    <button data-testid="totp-confirm" onclick={confirm}>Turn on two-factor</button>
    {#if error}<p class="error">{error}</p>{/if}
  {:else}
    <!-- Factors are composable: TOTP and any number of security keys can be added
         independently. The register button must stay reachable even once a factor
         exists (otherwise an existing vault could never add a key). -->
    {#if vaultStore.mfaEnrolled}
      <p class="enrolled" data-testid="mfa-enrolled"><span class="check" aria-hidden="true">✓</span>Two-factor is enrolled. Your vault now asks for a second step at unlock.</p>
    {/if}
    {#if !vaultStore.totpEnrolled}
      <button data-testid="totp-begin" onclick={begin}>Set up an authenticator app</button>
    {/if}
    <button class="secondary" data-testid="webauthn-register" onclick={registerKey} disabled={vaultStore.webauthnBusy}>
      {vaultStore.hasPasskey ? 'Add another security key' : 'Add a security key'}
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
  .explainer { color: var(--text-dim); font-size: 12.5px; line-height: 1.45; margin: 0 0 12px; }
  .step { color: var(--text); font-size: 13px; margin: 8px 0; }
  .manual-label { color: var(--text-dim); font-size: 12.5px; margin: 12px 0 6px; }
  .setup-key {
    display: block; font-family: ui-monospace, monospace;
    background: var(--bg); color: var(--accent);
    padding: 8px 10px; border-radius: 6px; word-break: break-all;
    font-size: 13px; letter-spacing: 0.5px;
  }
  .enrolled { color: var(--success); display: flex; align-items: center; gap: 8px; }
  .enrolled .check {
    flex: none; display: inline-flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; border-radius: 50%;
    background: var(--success); color: var(--bg); font-weight: 700; font-size: 13px;
  }
  .error { color: var(--danger); font-size: 13px; }
  img { width: 160px; height: 160px; border-radius: 8px; display: block; background: #fff; padding: 6px; box-sizing: border-box; }

  input {
    width: 100%; box-sizing: border-box; margin: 8px 0; padding: 8px 10px;
    background: var(--chrome-hi); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px;
    outline: none; font: inherit;
    transition: border-color .15s, box-shadow .15s;
  }
  input::placeholder { color: var(--text-dim); }
  input:focus { border-color: var(--accent-ring); box-shadow: 0 0 0 3px var(--accent-soft); }

  button {
    display: block; margin: 8px 0 0;
    background: var(--accent); color: var(--bg); border: none; border-radius: 8px;
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
