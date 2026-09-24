//! Shield Engine: High-performance network request filtering and cosmetic resource extraction.
//!
//! Powered by Brave's `adblock-rust` crate with support for ABP/uBlock rule syntax,
//! dynamic cosmetic filtering via MutationObserver, scriptlet injection, and fast cold-boot
//! serialization cache.

pub mod cosmetic;
pub mod engine;
pub mod filter_lists;
pub mod interceptor;

pub use cosmetic::CosmeticResources;
pub use engine::{BlockResult, ShieldEngine, ShieldError, ShieldStats};
pub use filter_lists::{FilterListManager, FilterUpdateReport, EASYLIST_URL, EASYPRIVACY_URL};
pub use interceptor::{normalize_resource_type, RequestInterceptor};
