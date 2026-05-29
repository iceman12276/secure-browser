# Manual test — WebAuthn security-key ceremony (hardware-dependent)

This runbook covers the **live FIDO2 / passkey ceremony** that cannot run in CI
(it needs a physical authenticator and a real OS prompt). It implements plan
**M4.7 Step 5**. Everything else about MFA — the Rust RP state machine,
challenge generation, JSON serialization, and the master-password + TOTP unlock —
is already covered by automated tests (`core/src/webauthn.rs`, `tests/mfa.spec.ts`).

## What this validates

1. **Registration** — enrolling a security key / passkey as a second factor.
2. **Unlock** — clearing the awaiting-second-factor gate by asserting that key.

## Why it's manual (scope)

- WebAuthn binds the ceremony to the renderer's **origin**. `electron-vite dev`
  serves the chrome view over `http://localhost:<port>`, which is a valid
  WebAuthn origin; the RP (`build_rp()` in `core/src/webauthn.rs`) is configured
  for `rp_id = "localhost"` with `allow_any_port(true)` so the dev port matches.
- A **production** build loads the renderer from `file://`, which is **not** a
  valid WebAuthn origin. So this ceremony is exercised on a **dev build only**.
  Making WebAuthn unlock work in a packaged build (custom secure scheme or a
  loopback HTTP server) is out of scope here and tracked separately.
- The browser round-trip uses Chromium's native WebAuthn JSON APIs
  (`PublicKeyCredential.parseCreationOptionsFromJSON` / `parseRequestOptionsFromJSON`
  and `credential.toJSON()`), available in Electron 42's Chromium — so no manual
  base64url↔ArrayBuffer conversion is needed (`electron/renderer/src/lib/webauthn.ts`).

## Prerequisites

- A roaming **FIDO2 USB security key** (e.g. YubiKey) plugged into this machine.
  - Alternative: a phone passkey via cross-device **hybrid/QR** (needs Bluetooth +
    a recent Chromium); choose "Use a phone or tablet" at the OS prompt.
- A dev build (the steps below). Do **not** use a packaged/production build.

## Setup

```bash
# from the repo root
npm run build:core   # build the napi core (Rust)
npm run dev          # electron-vite dev — serves the chrome view over http://localhost:<port>
```

On launch (dev only) the chrome view's **DevTools** opens detached. Keep it
visible — the ceremony logs a `[webauthn]` trace to its Console, and that trace
plus the in-app red error banner (`data-testid="vault-error"`) are your
diagnostics. Nothing secret is logged (challenges are public nonces; no master
password or vault secret is touched).

## Part A — Register a security key

1. If the vault doesn't exist yet, create it: enter a master password and submit.
   If it exists, unlock it (master password, then TOTP if you've enrolled one).
2. In the vault sidebar, under **Two-factor authentication**, click
   **Register security key / passkey** (`data-testid="webauthn-register"`).
3. Complete the OS / authenticator prompt:
   - USB key: touch the key when it blinks (enter PIN if your key has one).
   - Phone hybrid: scan the QR and approve on the phone.
4. **Expected:** the sidebar shows **✅ A second factor is enrolled.**
   (`data-testid="mfa-enrolled"`), and the DevTools Console shows:
   ```
   [webauthn] registration: received creation challenge from RP
   [webauthn] registration: authenticator produced a credential, finishing with RP
   [webauthn] registration: complete
   ```
5. If a red error banner appears instead, record its exact text and the full
   `[webauthn]` trace (see Troubleshooting).

## Part B — Unlock with the security key

1. Lock the vault: click **Lock**, or wait ~5 minutes for idle auto-lock.
2. Unlock with the **master password**. Because a second factor is enrolled, the
   vault enters the **awaiting-second-factor** state and shows the second-factor
   prompt (`data-testid="mfa-prompt"`) — credential operations stay locked. The
   prompt shows only the factors you enrolled: the TOTP field appears if a TOTP
   secret is set, and the **Unlock with security key** button appears if a passkey
   is registered. On a passkey-only vault you'll see just the button.
3. Click **Unlock with security key** (`data-testid="webauthn-unlock"`).
4. Complete the OS / authenticator prompt (touch the key / approve on phone).
5. **Expected:** the gate clears, the credential list becomes visible/usable, and
   the Console shows:
   ```
   [webauthn] authentication: received request challenge from RP
   [webauthn] authentication: authenticator produced an assertion, verifying with RP
   [webauthn] authentication: RP verdict = true
   ```
   (You can still fall back to the TOTP code field if you enrolled TOTP too.)

## Results — fill in and paste into the PR description

| Step | Authenticator | Result (PASS/FAIL) | Notes |
|------|---------------|--------------------|-------|
| A. Register | YubiKey (USB) | | |
| B. Unlock   | YubiKey (USB) | | |
| A. Register | Phone (hybrid) | | (optional) |
| B. Unlock   | Phone (hybrid) | | (optional) |

- OS / Chromium build:
- Date:

## Troubleshooting

- **Red error banner with an `origin` / `Configuration` message** — the RP
  rejected the assertion origin. `allow_any_port(true)` should make any
  `http://localhost:<port>` valid; if it still fails, capture the exact dev URL
  (DevTools → top of Console / Network) and the error text.
- **`no passkeys registered; cannot start authentication`** — you clicked
  *Unlock with security key* before registering one (Part A), or registration
  didn't persist. Re-run Part A and confirm the `mfa-enrolled` indicator.
- **A `DataError` / `SyntaxError` from `parseCreationOptionsFromJSON` or a
  deserialization error from the RP on finish** — a JSON shape mismatch between
  webauthn-rs and the browser. Capture: the full `[webauthn]` trace, the thrown
  error text, and (DevTools → Console) `JSON.parse(...)` of the challenge if
  visible. This is the one residual risk of the "verify once" approach and is a
  one-line fix in `electron/renderer/src/lib/webauthn.ts` once the exact field is
  known.
- **No OS prompt appears** — ensure the key is seated and that the dev window has
  focus; some Linux setups need `udev` rules for FIDO2 devices (e.g. the
  `libfido2`/Yubico udev rules) for Chromium to see the key. Note: on launch a
  **detached DevTools window opens (dev only)** and on some Linux window managers
  it can steal focus, which prevents Chromium from anchoring the WebAuthn OS
  prompt to the app window (the prompt may not appear, or appear behind). If no
  prompt shows, click the **main app window** to focus it, then trigger the
  ceremony again.

## If you need to capture deeper detail

In `electron/renderer/src/lib/webauthn.ts` the helpers already log a `[webauthn]`
trace. To dump the raw challenge/response JSON for a failing run, temporarily add
`console.log('[webauthn] challenge', challengeJson)` /
`console.log('[webauthn] response', responseJson)` and re-run — then remove it.
