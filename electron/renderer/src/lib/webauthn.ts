// Browser-side WebAuthn ceremony helpers.
//
// The Rust Relying Party (webauthn-rs) issues challenge *options* as JSON and
// consumes the credential *response* as JSON. We bridge that to
// navigator.credentials using Chromium's native WebAuthn JSON serialization —
// PublicKeyCredential.parseCreationOptionsFromJSON / parseRequestOptionsFromJSON
// (options JSON -> live request with ArrayBuffer fields) and
// PublicKeyCredential.prototype.toJSON() (live response -> response JSON).
//
// These APIs (Chromium >= 130, present in Electron 42) emit/consume exactly the
// W3C JSON shapes that webauthn-rs serializes (`CreationChallengeResponse` /
// `RequestChallengeResponse`, both wrapped under a `publicKey` key) and
// deserializes (`RegisterPublicKeyCredential` / `PublicKeyCredential`). So no
// manual base64url<->ArrayBuffer conversion is needed; the browser does it.
//
// This path is hardware-dependent and validated MANUALLY (see
// tests/manual/webauthn-hardware-ceremony.md), not in CI. TOTP is the fully
// automated factor.

// The native JSON static methods are newer than some TS DOM lib versions type,
// so describe just the surface we use and assert onto it. The returned option
// objects are the standard ArrayBuffer-based lib.dom types, which is exactly
// what navigator.credentials.create/get expect.
interface PublicKeyCredentialJsonStatics {
  parseCreationOptionsFromJSON(json: unknown): PublicKeyCredentialCreationOptions;
  parseRequestOptionsFromJSON(json: unknown): PublicKeyCredentialRequestOptions;
}

interface CredentialToJSON {
  toJSON(): unknown;
}

function webAuthnStatics(): PublicKeyCredentialJsonStatics {
  const ctor = (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential;
  if (!ctor) {
    throw new Error('WebAuthn (PublicKeyCredential) is unavailable in this renderer context');
  }
  return ctor as PublicKeyCredentialJsonStatics;
}

const log = (...args: unknown[]): void => console.log('[webauthn]', ...args);

/** The Rust challenge JSON wraps the options under `publicKey`. */
function unwrapPublicKey(challengeJson: string): unknown {
  const parsed = JSON.parse(challengeJson) as { publicKey?: unknown };
  if (!parsed || typeof parsed !== 'object' || !('publicKey' in parsed)) {
    throw new Error('malformed WebAuthn challenge: missing publicKey');
  }
  return parsed.publicKey;
}

/**
 * Run the registration ceremony: ask the Rust RP for creation options, drive the
 * authenticator via navigator.credentials.create(), and hand the response back
 * to the RP to persist the passkey. Throws on any failure (surfaced by caller).
 */
export async function registerSecurityKey(): Promise<void> {
  const { challengeJson, stateJson } = await window.secureBrowser.webauthn.startRegistration();
  log('registration: received creation challenge from RP');
  const options = webAuthnStatics().parseCreationOptionsFromJSON(unwrapPublicKey(challengeJson));
  const cred = await navigator.credentials.create({ publicKey: options });
  if (!cred) throw new Error('authenticator returned no credential (registration cancelled)');
  log('registration: authenticator produced a credential, finishing with RP');
  const responseJson = JSON.stringify((cred as unknown as CredentialToJSON).toJSON());
  await window.secureBrowser.webauthn.finishRegistration(responseJson, stateJson);
  log('registration: complete');
}

/**
 * Run the authentication (unlock) ceremony: ask the Rust RP for request options,
 * drive the authenticator via navigator.credentials.get(), and hand the assertion
 * back to the RP to verify. Returns true iff the RP accepted the assertion.
 */
export async function authenticateSecurityKey(): Promise<boolean> {
  const { challengeJson, stateJson } = await window.secureBrowser.webauthn.startAuthentication();
  log('authentication: received request challenge from RP');
  const options = webAuthnStatics().parseRequestOptionsFromJSON(unwrapPublicKey(challengeJson));
  const assertion = await navigator.credentials.get({ publicKey: options });
  if (!assertion) throw new Error('authenticator returned no assertion (authentication cancelled)');
  log('authentication: authenticator produced an assertion, verifying with RP');
  const responseJson = JSON.stringify((assertion as unknown as CredentialToJSON).toJSON());
  const ok = await window.secureBrowser.webauthn.finishAuthentication(responseJson, stateJson);
  log('authentication: RP verdict =', ok);
  return ok;
}
