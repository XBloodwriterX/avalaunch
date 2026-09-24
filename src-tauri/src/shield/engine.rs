use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::RwLock;

use adblock::lists::{FilterSet, ParseOptions};
use adblock::request::Request;
use adblock::Engine;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::shield::cosmetic::CosmeticResources;

/// Error types emitted by the Shield Engine and Filter List Manager.
#[derive(Debug, Error)]
pub enum ShieldError {
    #[error("Engine deserialization failed: {0}")]
    DeserializationError(String),

    #[error("Engine serialization failed: {0}")]
    SerializationError(String),

    #[error("Failed to parse request: url='{url}', source_url='{source_url}', type='{request_type}': {reason}")]
    RequestParseError {
        url: String,
        source_url: String,
        request_type: String,
        reason: String,
    },

    #[error("Filter list download failed for '{url}': {source}")]
    DownloadError {
        url: String,
        #[source]
        source: reqwest::Error,
    },

    #[error("HTTP error {status} downloading filter list from '{url}'")]
    HttpStatusError {
        url: String,
        status: reqwest::StatusCode,
    },

    #[error("Failed to read cache file '{path}': {source}")]
    CacheReadError {
        path: String,
        #[source]
        source: std::io::Error,
    },

    #[error("Failed to write cache file '{path}': {source}")]
    CacheWriteError {
        path: String,
        #[source]
        source: std::io::Error,
    },

    #[error("Failed to locate application cache directory")]
    CacheDirectoryError,

    #[error("Filter list error: {0}")]
    FilterListError(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

/// Statistics tracking ad-blocking decisions made by the Shield Engine.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct ShieldStats {
    /// Number of network requests blocked.
    pub blocked_count: u64,
    /// Number of network requests allowed.
    pub allowed_count: u64,
    /// Number of cosmetic elements or resources injected/hidden.
    pub cosmetic_count: u64,
}

/// Result of evaluating a network request against the Shield Engine.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct BlockResult {
    /// Whether the network request should be blocked.
    pub matched: bool,
    /// The rule text or filter that caused the request to be matched/blocked (if available).
    pub filter: Option<String>,
    /// Optional redirect URL (e.g. for surrogate scripts or empty pixels).
    pub redirect_url: Option<String>,
}

/// High-performance ad-blocking and cosmetic filtering engine wrapping `adblock-rust`.
///
/// Thread-safe (`Send + Sync`) and designed for `Arc<ShieldEngine>` sharing across Tauri state.
pub struct ShieldEngine {
    engine: RwLock<Engine>,
    blocked_count: AtomicU64,
    allowed_count: AtomicU64,
    cosmetic_count: AtomicU64,
}

impl ShieldEngine {
    /// Create a new Shield Engine initialized from raw filter list strings.
    pub fn new(filter_lists: Vec<String>) -> Result<Self, ShieldError> {
        let mut filter_set = FilterSet::new(true);
        for list_text in filter_lists {
            filter_set.add_filter_list(list_text, ParseOptions::default());
        }
        let engine = Engine::new_with_filter_set(filter_set);
        Ok(Self {
            engine: RwLock::new(engine),
            blocked_count: AtomicU64::new(0),
            allowed_count: AtomicU64::new(0),
            cosmetic_count: AtomicU64::new(0),
        })
    }

    /// Create a new Shield Engine from an existing [`FilterSet`].
    pub fn from_filter_set(filter_set: FilterSet) -> Self {
        let engine = Engine::new_with_filter_set(filter_set);
        Self {
            engine: RwLock::new(engine),
            blocked_count: AtomicU64::new(0),
            allowed_count: AtomicU64::new(0),
            cosmetic_count: AtomicU64::new(0),
        }
    }

    /// Create an empty Shield Engine.
    pub fn empty() -> Self {
        Self {
            engine: RwLock::new(Engine::default()),
            blocked_count: AtomicU64::new(0),
            allowed_count: AtomicU64::new(0),
            cosmetic_count: AtomicU64::new(0),
        }
    }

    /// Instantiate a Shield Engine from serialized byte cache for fast startup.
    pub fn from_serialized(data: &[u8]) -> Result<Self, ShieldError> {
        let mut engine = Engine::default();
        engine
            .deserialize(data)
            .map_err(|e| ShieldError::DeserializationError(format!("{:?}", e)))?;
        Ok(Self {
            engine: RwLock::new(engine),
            blocked_count: AtomicU64::new(0),
            allowed_count: AtomicU64::new(0),
            cosmetic_count: AtomicU64::new(0),
        })
    }

    /// Check whether a network request should be blocked, allowed, or redirected.
    pub fn check_request(&self, url: &str, source_url: &str, request_type: &str) -> BlockResult {
        let req = match Request::new(url, source_url, request_type, "GET") {
            Ok(r) => r,
            Err(_) => {
                self.allowed_count.fetch_add(1, Ordering::Relaxed);
                return BlockResult {
                    matched: false,
                    filter: None,
                    redirect_url: None,
                };
            }
        };

        let engine = self.engine.read().expect("ShieldEngine lock poisoned");
        let blocker_result = engine.check_network_request(&req);
        let matched = blocker_result.should_block();

        if matched {
            self.blocked_count.fetch_add(1, Ordering::Relaxed);
        } else {
            self.allowed_count.fetch_add(1, Ordering::Relaxed);
        }

        let filter = blocker_result
            .filter
            .as_ref()
            .and_then(|f| f.raw_line.clone())
            .or_else(|| {
                if matched {
                    Some("matched_rule".to_string())
                } else {
                    None
                }
            });

        let redirect_url = blocker_result.redirect.or(blocker_result.rewritten_url);

        BlockResult {
            matched,
            filter,
            redirect_url,
        }
    }

    /// Retrieve cosmetic filtering resources (CSS selectors and scriptlets) for a given page URL.
    pub fn get_cosmetic_resources(&self, page_url: &str) -> CosmeticResources {
        let engine = self.engine.read().expect("ShieldEngine lock poisoned");
        let raw_resources = engine.url_cosmetic_resources(page_url);
        let cosmetic = CosmeticResources::from_url_resources(&raw_resources);
        if !cosmetic.hide_selectors.is_empty() || !cosmetic.injected_script.is_empty() {
            self.cosmetic_count.fetch_add(1, Ordering::Relaxed);
        }
        cosmetic
    }

    /// Match dynamically discovered CSS classes and IDs against generic hiding rules.
    pub fn get_hidden_selectors(
        &self,
        classes: &[String],
        ids: &[String],
        exceptions: &[String],
    ) -> Vec<String> {
        let exceptions_set: HashSet<String> = exceptions.iter().cloned().collect();
        let engine = self.engine.read().expect("ShieldEngine lock poisoned");
        let mut selectors = engine.hidden_class_id_selectors(
            classes.iter().map(|s| s.as_str()),
            ids.iter().map(|s| s.as_str()),
            &exceptions_set,
        );
        selectors.sort();
        if !selectors.is_empty() {
            self.cosmetic_count
                .fetch_add(selectors.len() as u64, Ordering::Relaxed);
        }
        selectors
    }

    /// Serialize the engine state into bytes for disk caching.
    pub fn serialize(&self) -> Result<Vec<u8>, ShieldError> {
        let engine = self.engine.read().expect("ShieldEngine lock poisoned");
        Ok(engine.serialize())
    }

    /// Deserialize engine state from bytes and update this engine.
    pub fn deserialize(&self, data: &[u8]) -> Result<(), ShieldError> {
        let mut new_engine = Engine::default();
        new_engine
            .deserialize(data)
            .map_err(|e| ShieldError::DeserializationError(format!("{:?}", e)))?;
        let mut engine = self.engine.write().expect("ShieldEngine lock poisoned");
        *engine = new_engine;
        Ok(())
    }

    /// Get current cumulative blocking statistics.
    pub fn stats(&self) -> ShieldStats {
        ShieldStats {
            blocked_count: self.blocked_count.load(Ordering::Relaxed),
            allowed_count: self.allowed_count.load(Ordering::Relaxed),
            cosmetic_count: self.cosmetic_count.load(Ordering::Relaxed),
        }
    }

    /// Reset statistics counters to zero.
    pub fn reset_stats(&self) {
        self.blocked_count.store(0, Ordering::Relaxed);
        self.allowed_count.store(0, Ordering::Relaxed);
        self.cosmetic_count.store(0, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shield_engine_creation_and_matching() {
        let rules = vec![
            "||doubleclick.net^$third-party".to_string(),
            "||googlesyndication.com^".to_string(),
            "@@||doubleclick.net/whitelist^".to_string(),
            "example.com##.ad-banner".to_string(),
            "##.generic-sponsor".to_string(),
        ];

        let engine = ShieldEngine::new(rules).expect("Failed to create ShieldEngine");

        // Blocked request
        let res = engine.check_request(
            "https://ad.doubleclick.net/ad.js",
            "https://example.com",
            "script",
        );
        assert!(res.matched, "Doubleclick request should be blocked");

        // Whitelisted request
        let res_wl = engine.check_request(
            "https://doubleclick.net/whitelist",
            "https://example.com",
            "script",
        );
        assert!(!res_wl.matched, "Whitelisted request should not be blocked");

        // Allowed request
        let res_ok = engine.check_request(
            "https://example.com/main.js",
            "https://example.com",
            "script",
        );
        assert!(!res_ok.matched, "First-party script should be allowed");

        let stats = engine.stats();
        assert_eq!(stats.blocked_count, 1);
        assert_eq!(stats.allowed_count, 2);
    }

    #[test]
    fn test_cosmetic_resources_extraction() {
        let rules = vec![
            "music.youtube.com##.ytmusic-ad-slot".to_string(),
            "music.youtube.com#@#.ytmusic-good-slot".to_string(),
            "##.global-ad-container".to_string(),
        ];

        let engine = ShieldEngine::new(rules).expect("Failed to create ShieldEngine");

        let cosmetic = engine.get_cosmetic_resources("https://music.youtube.com");
        assert!(
            cosmetic
                .hide_selectors
                .contains(&".ytmusic-ad-slot".to_string()),
            "Specific hide selector should be returned"
        );

        // Generic selector matching
        let hidden = engine.get_hidden_selectors(
            &["global-ad-container".to_string(), "normal-content".to_string()],
            &[],
            &[],
        );
        assert!(
            hidden.contains(&".global-ad-container".to_string()),
            "Generic selector matching class should be returned"
        );
        assert_eq!(hidden.len(), 1);
    }

    #[test]
    fn test_engine_serialization_roundtrip() {
        let rules = vec![
            "||tracker.example.com^".to_string(),
            "example.org##.sidebar-ad".to_string(),
        ];

        let engine = ShieldEngine::new(rules).expect("Failed to create ShieldEngine");
        let serialized = engine.serialize().expect("Serialization failed");
        assert!(!serialized.is_empty(), "Serialized bytes should not be empty");

        // Recreate from serialized bytes
        let engine2 = ShieldEngine::from_serialized(&serialized).expect("Deserialization failed");

        let res = engine2.check_request(
            "https://tracker.example.com/track",
            "https://example.org",
            "script",
        );
        assert!(res.matched, "Deserialized engine should block tracker");

        let res2 = engine2.check_request(
            "https://example.org/app.js",
            "https://example.org",
            "script",
        );
        assert!(!res2.matched, "Deserialized engine should allow app.js");
    }
}
