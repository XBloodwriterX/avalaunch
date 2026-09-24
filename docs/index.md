# Documentation Index

This is the entry point for all project documentation. Use this file to navigate to the document you need.

## Core Documents

| Document | Purpose |
|----------|---------| 
| [`techstack.md`](./techstack.md) | Technology stack, versions, and compatibility notes |
| [`architecture.md`](./architecture.md) | System overview, component boundaries, data flow, and ad-blocking strategy |
| [`current-sprint.md`](./current-sprint.md) | Living document of current goals, tasks, and decisions |

## Component Documents

| Document | Purpose |
|----------|---------| 
| [`shield-engine.md`](./shield-engine.md) | Ad-blocking engine integration details & concurrency model |
| [`platform-interception.md`](./platform-interception.md) | Platform-specific request interception architecture |
| [`filter-lists.md`](./filter-lists.md) | Filter list management, caching, and update lifecycle |
| [`frontend-injector.md`](./frontend-injector.md) | Frontend cosmetic filtering, MutationObserver, scriptlets & SPA tracking |
| [`configuration.md`](./configuration.md) | App configuration schema, options, and defaults |
| [`packaging-and-distribution.md`](./packaging-and-distribution.md) | Packaging targets, build pipeline, runtime requirements, and distribution verification |
| [`security-and-privacy.md`](./security-and-privacy.md) | Security model, sandboxing, network privacy & data isolation guarantees |
| [`testing.md`](./testing.md) | Testing strategy, verification commands, assertions & CI troubleshooting |

## Decision Log

| Document | Purpose |
|----------|---------| 
| [`decisions/001-build-from-scratch.md`](./decisions/001-build-from-scratch.md) | ADR: Build from scratch vs. fork Pake |
| [`decisions/002-hybrid-network-cosmetic-interception.md`](./decisions/002-hybrid-network-cosmetic-interception.md) | ADR: Hybrid network and cosmetic interception architecture |

## How to Use This Index

- **Starting a new session**: Read `AGENTS.md` → this file → `current-sprint.md` → relevant component docs.
- **Adding a new document**: Create the file and add a row to the appropriate table above.
- **Looking for decisions**: Check `decisions/` for recorded architectural choices.
- **Understanding the system**: Start with `architecture.md`, then drill into component docs.

## Documentation Principles

1. **Modularity**: Each document covers one coherent topic.
2. **Stability**: Core documents change only when the system changes.
3. **Living context**: `current-sprint.md` is updated every session.
4. **Decision tracking**: Major decisions recorded in `decisions/` with context and consequences.
5. **English only**: All documentation in English.
6. **Execution over design**: Architecture is fixed. Agents execute, not redesign.
