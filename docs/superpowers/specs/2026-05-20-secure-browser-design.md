# Secure Browser — Local-First Browser with Embedded Password Manager

## Context

The user wants to build a web browser (à la Chrome) with a password manager and
account-security system (MFA, passkeys, security keys) embedded directly in it.
Primary goal is **learning**, with a strong secondary goal of **personal daily use**
(the user is user #1). Single-user, local-first — no multi-tenant infra.

The user already built a school capstone password manager
(`~/Desktop/dev/Lock-and-Key-...` and a TanStack rewrite at
`~/Desktop/dev/password-manager`). It uses **post-quantum hybrid crypto
(ML-KEM-768 + AES-256-GCM), Argon2id KDF, zero-knowledge** (master password never
leaves client), TOTP MFA, and a **browser extension that was scaffolded but never
finished**. That stack was Next.js/TanStack + 9 Express microservices + Kong +
Supabase + a Python quantum service + microk8s — most of its documented pain came
from that distributed/cloud complexity, which is overkill for one local user.

This project is a **fresh tech stack** (explicit user requirement) that:
1. Finishes the autofill story for real by **owning the browser**.
2. Drops microservices/cloud for a **local-first** design.
3. Adds passkey-**provider** capability in a later phase.

The capstone is reference-only (logic + lessons); **not** copy-pasted.

## Key Decisions (settled with user)

| Decision | Choice |
|---|---|
| Goal | Learning + personal daily use (single user) |
| Form factor | Browser with embedded password manager |
| Browser shell | **Electron** (TypeScript) — real Chromium rendering, multi-tab, deep page injection, CDP access for the later passkey-provider phase |
| Vault/crypto core | **Rust** via `napi-rs` native addon, in-process in Electron main |
| Storage | **Local encrypted SQLite** (no server) |
| Crypto (carried forward) | ML-KEM-768 + AES-256-GCM hybrid, Argon2id KDF, zero-knowledge |
| Security scope | **Phased**: vault-UNLOCK security first (MFA/passkey/security key); passkey-PROVIDER later |
| MVP | Browser + vault + autofill + unlock security |
| Repo | `~/Desktop/dev/secure-browser`, new git repo, **push to GitHub** (gh authed as `iceman12276`) |

Toolchain verified present: Node v22.15.1, Rust/cargo 1.94.1, gh authenticated.

## Architecture (four trust-separated components)

```
┌─────────────────────────── Electron Main Process (trusted) ───────────────────────────┐
│  Tab orchestration (WebContentsView)   IPC router (validated, allow-listed)            │
│  ┌─────────────────────────── Rust Vault Core (napi-rs addon) ──────────────────────┐  │
│  │  Argon2id KDF · ML-KEM-768 + AES-256-GCM · TOTP · webauthn-rs RP                  │  │
│  │  SQLite (rusqlite + SQLCipher) — stores CIPHERTEXT only                           │  │
│  │  Master key held in memory only while unlocked; zeroized on lock/idle             │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────┘
        │ IPC (preload bridge, contextIsolation)            │ IPC
┌───────▼─────────────────────┐              ┌──────────────▼───────────────────────────┐
│  Chrome UI renderer          │              │  Tab renderers (sandboxed, untrusted)     │
│  toolbar/tabs/address bar    │              │  + injected content script (autofill)     │
│  vault sidebar/popup         │              │  page plaintext ⟂ vault plaintext         │
└──────────────────────────────┘             └────────────────────────────────────────────┘
```

**Security invariants:**
- Vault plaintext exists **only** in the Rust core's memory (main process). Never sent to tab renderers.
- Tab renderers: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. Content scripts reach the core only through a **minimal allow-listed IPC API**.
- Autofill injects plaintext into a page **only on explicit user gesture** and **only when page origin matches the stored credential origin** (anti-phishing).
- Master key derived on unlock, zeroized on lock and on idle-timeout auto-lock.

**Autofill data flow:** page load → content script scans DOM for login/signup forms →
reports `{origin, fields}` to main via preload IPC → main queries Rust core for
origin-matched credentials (requires unlocked vault) → returns **metadata only** (username,
label) → in-page overlay offers fill → on user click, main releases plaintext for that one
fill → on form submit, detect new/changed creds and prompt to save.

## Lessons applied from capstone
- **Persist the ML-KEM secret key** alongside ciphertext (their TOTP service discarded it → decryption 500s).
- **Surface decryption/lock errors** to the UI; never silently fail.
- No distributed-state traps (no Kong/ingress/`:latest` image caching class of bugs — N/A locally).
- Bake **audit logging into the schema from day 1** (they retrofitted it).

## Repository layout (created by Task 0)
```
secure-browser/
  package.json            # Electron + TS, electron-builder, Playwright
  electron/
    main/                 # main process: windows, tabs, IPC router, auto-lock
    preload/              # context-isolated bridges (chrome UI + content script)
    renderer/             # chrome UI (React or Svelte — confirm in M1)
    content/              # autofill content script
  core/                   # Rust napi-rs crate (vault + crypto + totp + webauthn-rs)
    src/{kdf,crypto,vault,totp,webauthn,storage}.rs
    Cargo.toml
  tests/                  # Playwright (_electron) integration + a local test login page
  .gitignore  README.md  LICENSE
```

## Implementation Milestones

**Task 0 — Repo + scaffold + CI baseline**
- `git init` at `~/Desktop/dev/secure-browser`; create GitHub repo via `gh repo create` and push.
- Scaffold Electron+TS app and `napi-rs` Rust crate that loads into Electron main and returns a value across the boundary (smoke test the bridge).
- `.gitignore`, README (goals + arch), license, initial commit.
- **Verify:** `npm run build` succeeds; Electron opens a window; a trivial Rust core function is callable from main and asserted in a test.

**M1 — Browser shell**
- Tabs via `WebContentsView`, address bar, back/forward/reload, new/close tab, basic history.
- Harden tab `webPreferences` (sandbox, contextIsolation, no nodeIntegration).
- **Verify:** Playwright `_electron` test navigates to a URL across two tabs; assert titles/URLs; assert renderer cannot access Node.

**M2 — Rust vault core + minimal vault UI**
- Crates: `argon2`, `aes-gcm`, `ml-kem` (or `liboqs`/`oqs`), `rusqlite` + SQLCipher, `zeroize`.
- API (napi): `init_vault`, `unlock(master_pw)`, `lock`, `add_credential`, `get_credentials(origin)`, `get_secret(id)`, `list`, `delete`.
- Zero-knowledge: Argon2id(master_pw) → vault key; per-record ML-KEM-768 + AES-256-GCM; **store KEM secret key** with the record.
- Minimal vault sidebar UI: unlock screen, list, add/edit/delete.
- **Verify:** Rust unit tests (KDF determinism, encrypt→decrypt round-trip, wrong-password fails cleanly, KEM key persists across reopen). Integration: add a credential, lock, reopen, unlock, read it back.

**M3 — Autofill engine**
- Content script: detect login/signup forms (heuristics modeled on Chromium's password form parser); report origin+fields.
- Origin-matched fill on explicit user gesture via in-page overlay; capture-and-save on submit.
- **Verify:** Playwright drives a bundled local test login page; assert fields fill only after click; assert no autofill on origin mismatch; assert save prompt on submit.

**M4 — Unlock security (MFA / passkey / security key)**
- TOTP enroll/verify in Rust core (QR/secret), encrypted at rest (apply the persistence lesson).
- WebAuthn unlock via `webauthn-rs` RP logic: register a platform authenticator (Touch ID / Windows Hello) and/or roaming FIDO2 security key; a successful assertion gates vault unlock.
- (Enhancement, note only) WebAuthn **PRF extension** to derive a vault-unlock secret from the security key.
- Auto-lock on idle timeout + manual lock.
- **Verify:** TOTP unit tests against RFC 6238 vectors; integration test of master-password + TOTP unlock; manual test of security-key unlock (hardware-dependent).

## Phase 2 (post-MVP, out of scope for first plan)
- **Passkey provider** for other websites: Electron CDP `WebAuthn` domain virtual authenticator backed by vault-stored keys → browser fills passkeys into visited sites like Google does.
- **Multi-device sync**: this is where a server returns — Postgres/Supabase as an encrypted-blob sync backend (vault stays zero-knowledge).

## Testing strategy
- **Rust**: `cargo test` for all crypto/TOTP (deterministic, RFC vectors, round-trips, failure paths).
- **Electron**: Playwright `_electron` for navigation, autofill (bundled local login page), unlock flow.
- **Security checks**: assert renderer sandbox (no Node), assert IPC allow-list rejects unknown channels, assert no plaintext crosses to tab renderers.
- CI: GitHub Actions running `cargo test` + `npm test` on push.

## Open items to confirm during M1
- Chrome-UI framework: React vs Svelte (lean Svelte for a lighter shell; confirm at M1 start).
- SQLCipher vs app-level AES-only for the DB file (default: SQLCipher for defense-in-depth).
