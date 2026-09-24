# Shield Engine Internals

## Overview

The **Shield Engine** (`src-tauri/src/shield/`) is Avalaunch's core ad-blocking and privacy protection subsystem. It wraps Brave's `adblock` Rust crate (`0.13.3`), providing high-performance network request evaluation, cosmetic CSS selector extraction, anti-circumvention scriptlet execution, and persistent bytecode rule caching.

---

## Architecture & Concurrency Model

```
               ┌────────────────────────────────────────────────────────┐
               │              ShieldEngine (Send + Sync)                │
               │                                                        │
               │  ┌────────────────────────┐  ┌──────────────────────┐  │
               │  │  RwLock<adblock::Engine>│  │  ShieldStats (Atomic)│  │
               │  └───────────┬────────────┘  └──────────────────────┘  │
               └──────────────┼─────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌───────────────────┐┌───────────────────┐┌───────────────────┐
│  check_request()  ││get_cosmetic_res...││get_hidden_select..│
│ (Network Blocking)││  (CSS + Script)   ││ (Dynamic Classes) │
└───────────────────┘└───────────────────┘└───────────────────┘
```

- **Thread Safety**: Wrapped in `Arc<ShieldEngine>` and registered with `tauri::Builder::manage()`. Internal state uses `parking_lot::RwLock<adblock::Engine>` enabling concurrent read access for high-throughput request evaluation and exclusive write access during filter updates.
- **Atomic Telemetry**: Tracks `blocked_count`, `allowed_count`, and `cosmetic_count` using `std::sync::atomic::AtomicU64` with zero locking overhead.

---

## Key Interfaces

### 1. Network Request Evaluation
```rust
pub fn check_request(&self, url: &str, source_url: &str, request_type: &str) -> BlockResult
```
- Converts incoming URLs and resource types into `adblock::request::Request`.
- Evaluates against the compiled `FilterSet`.
- Returns `BlockResult` containing `matched: bool`, optional `filter: Option<String>`, and `redirect_url: Option<String>`.

### 2. Cosmetic Resource Extraction
```rust
pub fn get_cosmetic_resources(&self, page_url: &str) -> CosmeticResources
```
- Calls `adblock::Engine::url_cosmetic_resources()`.
- Extracts domain-specific CSS hide selectors and anti-circumvention scriptlets.
- Evaluates generic hiding permissions (`generics = !resources.generichide`).

### 3. Dynamic Selector Matching
```rust
pub fn get_hidden_selectors(&self, classes: &[String], ids: &[String], exceptions: &[String]) -> Vec<String>
```
- Calls `adblock::Engine::hidden_class_id_selectors()`.
- Returns CSS selectors that match newly discovered DOM elements.

### 4. Engine Cache Serialization
```rust
pub fn serialize(&self) -> Result<Vec<u8>, ShieldError>
pub fn from_serialized(bytes: &[u8]) -> Result<Self, ShieldError>
```
- Uses `adblock::Engine::serialize()` to save compiled FlatBuffers rule tables to disk (`adblock_cache.dat`).
- Cold boot loading from cache completes in `<25ms` compared to `~800ms` for raw text rule parsing.
