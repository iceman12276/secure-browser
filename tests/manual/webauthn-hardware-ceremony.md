# Manual test — security-key (FIDO2) ceremony

This runbook covers the **live security-key ceremony** that cannot run in CI (it
needs a physical authenticator and a human touch). Everything else about MFA —
the webauthn-rs Relying Party state machine, challenge generation, JSON
serialization, and the master-password + TOTP unlock — is covered by automated
tests (`core/src/webauthn.rs`, `tests/mfa.spec.ts`).

## How it works (and why it's native)

The ceremony runs as a **native CTAP2/FIDO2 client in the Rust core**
(`core/src/fido2.rs`, using Mozilla's `authenticator` crate — the engine Firefox
ships), talking to the USB key **directly over HID**. It does **not** use the
browser's `navigator.credentials`: Electron does not surface a WebAuthn UI on
Linux or macOS (upstream [electron/electron#24573](https://github.com/electron/electron/issues/24573)),
so the browser path hangs there. Driving the key natively works **cross-platform**
(Linux/macOS/Windows) with no Electron dependency, and keeps the security-critical
code in the audited Rust core. The native client produces the exact WebAuthn
response JSON our existing RP consumes (`finish_registration`/`finish_authentication`).

**Validated on Linux** (YubiKey 5, 2026-05-29): register + master-password +
security-key unlock all succeed; a full unlock takes ~1.7s, most of which is the
physical touch.

## About the touch (presence, not fingerprint)

A standard **YubiKey 5-series** gold contact is a **capacitive presence sensor**,
not a fingerprint reader — **any finger works**, and it cannot reject the "wrong"
finger. It satisfies WebAuthn **user presence (UP)**, not user verification (UV).
(Only the **YubiKey Bio** series has a fingerprint sensor.) The security here is
*possession of the physical key* + *a live human touch*, gated behind the master
password — not biometric identity. Accordingly the RP uses webauthn-rs's
**SecurityKey** API (UV-optional), not the Passkey API (which requires UV and
rejects a touch-only key).

## Prerequisites

- A **FIDO2 USB security key** (e.g. YubiKey 5). Touch-only/UP is fine; v1 does
  not drive a client PIN (a key that *requires* a PIN aborts with an error).
- **Linux build dep:** `libudev-dev` + `pkg-config` (for the native client;
  already in the CI jobs). **Runtime:** non-root HID access via udev `uaccess`
  (the `libu2f-udev` rules) — usually already present; verify the key's
  `/dev/hidraw*` node grants your user `rw` (replug the key if you just added rules).
- macOS/Windows need no extra setup.

## Setup

```bash
npm run build:core   # builds the napi core (needs libudev-dev on Linux)
npm run dev          # electron-vite dev — serves the chrome view over http://localhost:<port>
```

## Part A — Register a security key

1. Create the vault (master password → Create), or unlock an existing one.
2. In the vault sidebar, under **Two-factor authentication**, click
   **Register security key / passkey** (`data-testid="webauthn-register"`).
3. A spinner appears ("Waiting for your security key… touch it when it blinks").
   **Touch the key** (any finger, flat and firm on the gold contact).
4. **Expected:** a green **✓ "Security key registered"** flash, and
   **✅ A second factor is enrolled.** (`data-testid="mfa-enrolled"`).

## Part B — Unlock with the security key

1. Click **Lock**, then unlock with the **master password**. Because a second
   factor is enrolled, the vault enters the awaiting-second-factor state and shows
   the prompt (`data-testid="mfa-prompt"`). The prompt shows only the factors you
   enrolled — the **Unlock with security key** button appears when a key is registered.
2. Click **Unlock with security key** (`data-testid="webauthn-unlock"`) → spinner
   → **touch the key**.
3. **Expected:** a green **✓ "Unlocked with security key"** flash and the vault
   opens (credential list + Lock button visible). A full unlock is ~1–2s.

## Results — fill in and paste into the PR

| Step | Authenticator | Result (PASS/FAIL) | Notes |
|------|---------------|--------------------|-------|
| A. Register | YubiKey (USB) | | |
| B. Unlock   | YubiKey (USB) | | |

- OS / key model:
- Date:

## Troubleshooting

- **No prompt window appears** — that's expected: there is no browser dialog. The
  **key itself blinks**; just touch it. The in-app spinner is your cue.
- **Touch doesn't seem to register** — press **flat and firmly** so your finger
  fully covers the gold contact (it's presence, not fingerprint — see above). A
  glancing/edge touch may not trigger the capacitive sensor.
- **Red error banner** — read the text. `no credentials to authenticate` means no
  key is registered (do Part A first). A PIN-required message means the key
  demands a client PIN, which v1 does not yet drive (see Non-goals).
- **Permission denied / no device** — the key's `/dev/hidraw*` node isn't
  user-accessible; ensure the `libu2f-udev` rules are installed and **replug** the
  key so the `uaccess` ACL attaches.

## Non-goals (v1)

- **Non-resident credential, attestation "none", user-presence only** (UV
  discouraged). Interactive **client-PIN** entry and a live "touch now" progress
  event are planned enhancements; v1 shows a static spinner and aborts if a PIN is
  required.
- Multiple keys / credential dedup (stable per-vault user handle + `excludeCredentials`)
  is future work.
