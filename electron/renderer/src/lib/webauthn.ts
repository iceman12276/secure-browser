// Browser-side WebAuthn ceremony helpers.
//
// The Rust Relying Party (webauthn-rs) issues challenge *options* as JSON and
// consumes the credential *response* as JSON. We bridge that to
// navigator.credentials using Chromium's native WebAuthn JSON serialization —
// PublicKeyCredential.parseCreationOptionsFromJSON / parseRequestOptionsFromJSON
// (options JSON -> live request with ArrayBuffer fields) and
// PublicKeyCredential.prototype.toJSON() (live response -> response JSON).
//
// KNOWN PLATFORM LIMITATION (electron/electron#24573): Electron does not ship
// Chromium's WebAuthn UI on Linux or macOS, so navigator.credentials.create()/
// get() for USB/roaming security keys never surfaces a prompt and hangs until
// timeout. It works only on Windows (native OS WebAuthn API). To avoid an
// indefinite hang we abort the ceremony after CEREMONY_TIMEOUT_MS with a clear
// message. The cross-platform fix is a native CTAP2/FIDO2 client in the Rust
// core (driving the key over USB HID directly) — tracked as the next change;
// this browser path is interim and Windows-only. TOTP is the fully automated,
// cross-platform factor. See tests/manual/webauthn-hardware-ceremony.md.

const CEREMONY_TIMEOUT_MS = 20_000;

const UNSUPPORTED_MESSAGE =
  'No authenticator responded. On Linux/macOS, Electron does not surface the ' +
  'security-key prompt (electron #24573) — native security-key support is in ' +
  'progress. Use an authenticator app (TOTP) for now.';

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
 * Run navigator.credentials with a bounded timeout so the ceremony can never
 * hang (see the electron#24573 note above). On timeout we abort and raise a
 * clear, actionable message instead of leaving the promise pending forever.
 */
async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CEREMONY_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } catch (e) {
    if (controller.signal.aborted) throw new Error(UNSUPPORTED_MESSAGE);
    throw e;
  } finally {
    clearTimeout(timer);
  }
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
  const cred = await withTimeout((signal) => navigator.credentials.create({ publicKey: options, signal }));
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
  const assertion = await withTimeout((signal) => navigator.credentials.get({ publicKey: options, signal }));
  if (!assertion) throw new Error('authenticator returned no assertion (authentication cancelled)');
  log('authentication: authenticator produced an assertion, verifying with RP');
  const responseJson = JSON.stringify((assertion as unknown as CredentialToJSON).toJSON());
  const ok = await window.secureBrowser.webauthn.finishAuthentication(responseJson, stateJson);
  log('authentication: RP verdict =', ok);
  return ok;
}
