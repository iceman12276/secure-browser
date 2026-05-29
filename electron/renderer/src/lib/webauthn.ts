// Security-key ceremony helpers (renderer side).
//
// The WebAuthn ceremony runs as a NATIVE CTAP2 client in the Rust core (talking
// to the USB key over HID), NOT through the browser's navigator.credentials —
// Electron does not surface a WebAuthn UI on Linux/macOS (electron#24573). The
// renderer's job is only to shuttle JSON between the RP and the native client:
//
//   startRegistration (RP) -> nativeRegister (core drives the key) -> finishRegistration (RP)
//   startAuthentication (RP) -> nativeAuthenticate (core drives the key) -> finishAuthentication (RP)
//
// The native call blocks while the user touches the key (the core enforces its
// own timeout), so the UI should show a "touch your security key" hint while it
// is in flight (vaultStore.webauthnBusy).

const log = (...args: unknown[]): void => console.log('[webauthn]', ...args);

/**
 * Register a security key: get creation options from the RP, run the native
 * CTAP2 makeCredential in the core (user touches the key), hand the result back
 * to the RP to verify + persist. Throws on failure (surfaced by the caller).
 */
export async function registerSecurityKey(): Promise<void> {
  const { challengeJson, stateJson } = await window.secureBrowser.webauthn.startRegistration();
  log('registration: got challenge, invoking native CTAP2 client (touch your key)');
  const responseJson = await window.secureBrowser.webauthn.nativeRegister(challengeJson);
  log('registration: native ceremony complete, finishing with RP');
  await window.secureBrowser.webauthn.finishRegistration(responseJson, stateJson);
  log('registration: complete');
}

/**
 * Unlock with a security key: get request options from the RP, run the native
 * CTAP2 getAssertion in the core (user touches the key), hand the assertion back
 * to the RP to verify. Returns true iff the RP accepted it.
 */
export async function authenticateSecurityKey(): Promise<boolean> {
  const { challengeJson, stateJson } = await window.secureBrowser.webauthn.startAuthentication();
  log('authentication: got challenge, invoking native CTAP2 client (touch your key)');
  const responseJson = await window.secureBrowser.webauthn.nativeAuthenticate(challengeJson);
  log('authentication: native ceremony complete, verifying with RP');
  const ok = await window.secureBrowser.webauthn.finishAuthentication(responseJson, stateJson);
  log('authentication: RP verdict =', ok);
  return ok;
}
