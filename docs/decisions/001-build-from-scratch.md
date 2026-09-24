# ADR 001: Build from Scratch vs. Forking Pake

## Status

**Accepted** (Immutable)

## Context

Avalaunch needs to wrap arbitrary web URLs into native desktop applications with integrated ad-blocking and privacy protection. The existing open-source project [Pake](https://github.com/tw93/Pake) provides similar URL-wrapping functionality on top of Tauri.

## Decision

Build Avalaunch from scratch on Tauri v2, adopting architectural patterns from Pake without forking its codebase.

## Rationale

1. **Licensing Incompatibility**: Pake is licensed under GPL-3.0, a viral copyleft license. Avalaunch requires permissive dual-licensing (MIT / Apache-2.0) for flexible distribution and potential commercial/enterprise integration.

2. **No Native Interception Hooks**: Pake is designed as a lightweight, thin webview wrapper. It has no architecture for deep network request interception, which is Avalaunch's core differentiator — integrated ad and tracker blocking via native Rust middleware requires low-level webview hooks (`wry` / platform-specific APIs) and custom IPC bridges that Pake doesn't support.

3. **Extensible Security Middleware**: A purpose-built architecture allows deep integration of `adblock-rust`, custom filter lists, scriptlet injection, CSP enforcement, and local serialized rule caching without fighting against an existing codebase's assumptions.

4. **Fork Maintenance Burden**: Forking Pake would create ongoing merge conflict overhead with upstream changes while most of the fork's codebase would be replaced anyway for the ad-blocking architecture.

## Patterns Adopted from Pake

While built from scratch, Avalaunch adopts proven patterns:
- Declarative JSON configuration files (`avalaunch.json`, inspired by `pake.json`)
- Persistent window geometry and state storage
- System tray integration and menu shortcuts
- Per-domain custom User-Agent spoofing

## Consequences

- Full control over architecture and interception pipeline
- Higher initial development effort (no existing code to start from)
- Clean permissive licensing from day one
- No upstream dependency or merge conflicts
