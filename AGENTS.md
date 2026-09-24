# AGENTS.md — Operating Contract for Coding Agents

## Purpose

Ensure consistent, safe, and context-aware development of the Avalaunch desktop application. Prevent architectural drift, silent breaking changes, and documentation decay.

**Important**: Architecture is **already fixed** in `docs/architecture.md`. Agents do NOT redesign architecture. Agents execute and implement based on existing specifications.

## Mandatory Reading Order

Before performing any task, every agent session must:
1. Read `AGENTS.md` (this file)
2. Read `docs/index.md`
3. Read `docs/current-sprint.md` (once created)
4. Read any additional documents relevant to the task

## Coordinator Role

The Coordinator (main agent) is responsible for:
1. Reading context from `current-sprint.md` and relevant component docs
2. Creating subagents for focused tasks
3. Distributing tasks based on specialization
4. Running dsh workflows for repeatable processes
5. Merging results and updating documentation
6. Updating sprint document after each session

**The Coordinator does NOT redesign architecture.**

## Subagent Specializations

| Subagent | Specialization | Key Documents |
|----------|---------------|---------------|
| `shield-agent` | Ad-blocking engine: adblock crate integration, filter lists, request interception | `docs/architecture.md`, shield module |
| `tauri-agent` | Tauri app shell: window management, configuration, system tray, shortcuts | `docs/architecture.md`, lib.rs |
| `frontend-agent` | Frontend injection: cosmetic filtering JS, MutationObserver, service worker | `docs/architecture.md`, src/ |
| `platform-agent` | Platform-specific: wry-level interception, macOS/Linux/Windows adaptations | `docs/techstack.md` |
| `docs-agent` | Documentation: update sprint, create ADRs, maintain index | `AGENTS.md`, `docs/index.md` |
| `test-agent` | Testing: unit tests, integration tests, filter matching validation | `docs/architecture.md` |

## Documentation Growth Rule

When a new substantial component appears, create the corresponding document in `docs/` and add a link in `docs/index.md`.

Examples:
- Shield engine internals → `docs/shield-engine.md`
- Platform-specific interception → `docs/platform-interception.md`
- Filter list management → `docs/filter-lists.md`
- Configuration schema → `docs/configuration.md`
- Architectural decisions → `docs/decisions/*.md`

## Immutable Decisions

The following decisions are **immutable** unless explicitly changed via an ADR in `docs/decisions/`:
1. **Build from scratch**: Not forking Pake. See `docs/decisions/001-build-from-scratch.md`.
2. **adblock crate**: Using brave/adblock-rust as the filtering engine. No alternative engines.
3. **Tauri v2**: Using Tauri v2 (not v1, not Electron, not Wails).
4. **Hybrid ad-blocking**: Network-level + cosmetic filtering. Both are required.
5. **License**: MIT or Apache-2.0 (not GPL).

## Session Workflow

At the start of each session:
1. Read `AGENTS.md`, `docs/index.md`, `docs/current-sprint.md`.
2. Identify the active goal and current tasks.
3. Read any additional documents needed for the task.
4. Perform the work or delegate to subagents.
5. Update `docs/current-sprint.md`.

At the end of each session:
- Ensure all modified files are committed.
- Ensure `docs/current-sprint.md` reflects the current state.
- If a new document was created, add it to `docs/index.md`.

## Code Changes

- Do not modify Shield engine logic without understanding `docs/architecture.md`.
- Do not change Tauri configuration without understanding `docs/techstack.md`.
- Always run existing tests before proposing changes.
- All Rust code must pass `cargo clippy` and `cargo test`.

## Documentation Changes

- Keep documentation in English.
- Update documents incrementally; do not overwrite unless necessary.
- When adding a new document, update `docs/index.md`.
- When making an architectural decision, create an ADR in `docs/decisions/`.

## Risk Awareness

This project involves:
- Platform-specific webview APIs (WebView2, WebKitGTK, WKWebView)
- Third-party filter list compatibility (EasyList, uBlock Origin filters)
- Security-sensitive ad blocking (false positives break websites)
- Memory-intensive filter matching (25-40MB for full filter sets)

Always prioritize correctness over speed. A false positive (blocking legitimate content) is worse than a false negative (missing an ad).
