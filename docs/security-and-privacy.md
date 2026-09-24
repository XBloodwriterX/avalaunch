# Security and Privacy Architecture

Comprehensive reference for Avalaunch security guarantees, sandboxing boundaries, network egress policies, ad-blocking safety mechanisms, and user data isolation.

---

## 1. Threat Model & Trust Boundaries

Avalaunch enforces strict separation between untrusted web content and the privileged native runtime.

```
+-------------------------------------------------------------------------+
| UNTRUSTED REMOTE CONTEXT (Webview Frame / DOM / 3rd-Party Scripts)      |
|  - Target Web Apps (e.g., https://music.youtube.com)                    |
|  - Injected DOM Scripts: cosmetic-injector.js, network-interceptor.js   |
+-------------------------------------------------------------------------+
                                    |
                    Strict Capability Gateway (Tauri v2)
                    Only explicitly declared IPC commands
                                    |
+-------------------------------------------------------------------------+
| TRUSTED HOST CONTEXT (Rust / Tauri v2 Core / Native OS APIs)            |
|  - Shield Engine (brave/adblock-rust)                                   |
|  - Filter List Manager & Storage Caches                                 |
|  - Window State Persistence (tauri-plugin-window-state)                 |
+-------------------------------------------------------------------------+
```

### 1.1 Webview Capability Lockdown
Remote web execution runs under Tauri v2 capability scoping defined in `src-tauri/capabilities/default.json`. The webview boundary enforces:
- **Explicit IPC Whitelist**: The remote context can only invoke five dedicated Shield commands:
  - `check_url`: Evaluate request URLs against network filter rules.
  - `get_cosmetic_resources`: Fetch domain-matched CSS rules and scriptlets.
  - `get_hidden_selectors`: Match observed dynamic classes/IDs against generic cosmetic filters.
  - `get_blocking_stats`: Query blocking metrics (request counts, rules matched).
  - `update_filter_lists`: Trigger filter list cache refreshes.
- **Native OS Isolation**: Remote frames have zero access to native filesystem APIs, shell execution (`tauri-plugin-shell` process spawning is blocked from remote origins), OS process management, or internal hardware APIs.

---

## 2. Network Privacy & Egress Controls

Avalaunch operates with a zero-telemetry architecture designed for user privacy.

### 2.1 Egress Boundaries
Network egress is strictly confined to two pathways:

| Traffic Type | Destination | Frequency & Policy | Payload Content |
|---|---|---|---|
| **Web Application Traffic** | Target host (e.g., `https://music.youtube.com`) and its CDNs | Driven by user navigation and media playback | Standard web requests filtered by the Shield engine |
| **Filter List Synchronization** | Configured public mirrors (EasyList, EasyPrivacy, uBlock Origin) | Cached for 7 days; updated on expiry or explicit manual trigger | Standard HTTPS GET without user identifiers or telemetry |

### 2.2 Zero Telemetry Guarantee
- **No Analytics Backends**: Avalaunch binaries contain no analytics SDKs, error trackers (e.g., Sentry), or phone-home beacons.
- **Local Metrics Only**: Blocking counters and statistics are calculated in-memory and remain strictly local to the running instance.

---

## 3. Ad-Blocking Security Guarantees

The Shield engine combines network filtering and cosmetic element hiding to neutralize active web threats without compromising core application features.

### 3.1 Threat Neutralization
- **Cryptomining & Abuse Scripts**: Blocked at the network layer before initialization.
- **Tracking & Fingerprinting**: Analytics beacons, telemetry endpoints, and canvas/audio fingerprinting scripts are intercepted and dropped.
- **Malvertising & Forced Redirects**: Malicious third-party ad networks and redirect vectors are stripped from the DOM and blocked on wire.

### 3.2 Scriptlet Isolation
- **Isolated Execution**: Shield scriptlets (e.g., `set-local-storage-item`, `abort-current-inline-script`) execute inside isolated page contexts.
- **Token Protection**: Scriptlets operate without access to host tokens, IPC secrets, or Tauri internals.

### 3.3 Application Integrity & False-Positive Prevention
- **Media Preservation**: Audio/video streams, chunked media payloads, and primary player web workers bypass ad-blocking filters to ensure uninterrupted playback.
- **Core CDN Safeguards**: Primary vendor CDNs and script bundles essential for application bootstrapping remain unblocked.

---

## 4. User Data Isolation

User credentials, session storage, and state files are isolated across execution contexts.

### 4.1 Storage Partitioning
- **Profile Sandboxing**: Cookies, `localStorage`, `IndexedDB`, and HTTP caches reside in dedicated webview data directories isolated from other browser instances and system profiles.
- **Host Separation**: Native configurations and local filter list caches are stored in independent application support directories separate from webview storage.

### 4.2 Window State Privacy
- **Geometry-Only Persistence**: `tauri-plugin-window-state` persists window coordinates, dimensions, and display assignments locally.
- **Zero Credential Exposure**: Window state persistence files never capture, store, or serialize page tokens, authentication state, or browsing history.

---

## 5. Verification & Security Assertions

Verify security configurations and isolation guarantees using standard test suites:

```bash
# Verify Rust unit & integration security tests
cargo test --manifest-path src-tauri/Cargo.toml

# Verify capability declarations and command signatures
cargo clippy --manifest-path src-tauri/Cargo.toml

# Run frontend test suite
pnpm test
```
