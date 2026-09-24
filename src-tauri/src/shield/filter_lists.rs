use std::path::{Path, PathBuf};
use std::time::Duration;

use directories::ProjectDirs;
use serde::{Deserialize, Serialize};

use crate::shield::engine::ShieldError;

/// Official EasyList download URL.
pub const EASYLIST_URL: &str = "https://easylist.to/easylist/easylist.txt";

/// Official EasyPrivacy download URL.
pub const EASYPRIVACY_URL: &str = "https://easylist.to/easylist/easyprivacy.txt";

/// Default maximum cache age for filter lists (7 days).
pub const DEFAULT_CACHE_MAX_AGE_SECS: u64 = 7 * 24 * 60 * 60;

/// Report of filter list update operations.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct FilterUpdateReport {
    /// List names/URLs that were freshly downloaded and cached.
    pub updated: Vec<String>,
    /// List names/URLs that were fresh and served from local disk cache.
    pub cached: Vec<String>,
    /// List names/URLs that failed to download and have no fallback cache.
    pub failed: Vec<(String, String)>,
}

/// Manager responsible for downloading, caching, freshness-checking, and loading
/// ABP/uBlock-compatible filter lists.
pub struct FilterListManager {
    cache_dir: PathBuf,
    client: reqwest::Client,
    max_cache_age: Duration,
    custom_urls: Vec<String>,
}

impl FilterListManager {
    /// Create a new FilterListManager with the platform standard cache directory.
    pub fn new() -> Result<Self, ShieldError> {
        let cache_dir = Self::resolve_default_cache_dir()?;
        Ok(Self::with_cache_dir(cache_dir))
    }

    /// Create a FilterListManager with a custom cache directory path.
    pub fn with_cache_dir(cache_dir: PathBuf) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent("Avalaunch-Shield/0.1.0")
            .build()
            .unwrap_or_default();

        Self {
            cache_dir,
            client,
            max_cache_age: Duration::from_secs(DEFAULT_CACHE_MAX_AGE_SECS),
            custom_urls: Vec::new(),
        }
    }

    /// Resolve the standard application cache directory.
    pub fn resolve_default_cache_dir() -> Result<PathBuf, ShieldError> {
        if let Some(proj_dirs) = ProjectDirs::from("com", "avalaunch", "Avalaunch") {
            Ok(proj_dirs.cache_dir().join("filter_lists"))
        } else {
            Ok(std::env::temp_dir()
                .join("avalaunch")
                .join("filter_lists"))
        }
    }

    /// Returns a reference to the active cache directory.
    pub fn cache_dir(&self) -> &Path {
        &self.cache_dir
    }

    /// Set a custom max cache age before lists are considered stale.
    pub fn set_max_cache_age(&mut self, max_age: Duration) {
        self.max_cache_age = max_age;
    }

    /// Add a custom filter list URL.
    pub fn add_custom_url(&mut self, url: impl Into<String>) {
        self.custom_urls.push(url.into());
    }

    /// Set the list of custom filter list URLs.
    pub fn set_custom_urls(&mut self, urls: Vec<String>) {
        self.custom_urls = urls;
    }

    /// Check if a cached file exists, is non-empty, and was modified within the freshness duration.
    pub fn is_cache_fresh(&self, file_path: &Path) -> bool {
        if let Ok(metadata) = std::fs::metadata(file_path) {
            if metadata.len() == 0 {
                return false;
            }
            if let Ok(modified) = metadata.modified() {
                if let Ok(elapsed) = modified.elapsed() {
                    return elapsed <= self.max_cache_age;
                }
            }
        }
        false
    }

    /// Download the content of a filter list from a remote URL.
    pub async fn download_list(&self, url: &str) -> Result<String, ShieldError> {
        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|source| ShieldError::DownloadError {
                url: url.to_string(),
                source,
            })?;

        if !response.status().is_success() {
            return Err(ShieldError::HttpStatusError {
                url: url.to_string(),
                status: response.status(),
            });
        }

        let text = response
            .text()
            .await
            .map_err(|source| ShieldError::DownloadError {
                url: url.to_string(),
                source,
            })?;

        Ok(text)
    }

    /// Get a filter list from cache if fresh, or download and cache it if stale/missing.
    pub async fn get_or_fetch_list(&self, name: &str, url: &str) -> Result<String, ShieldError> {
        let safe_name = sanitize_filename(name);
        let cache_file = self.cache_dir.join(format!("{safe_name}.txt"));

        // Check if cached version is fresh
        if self.is_cache_fresh(&cache_file) {
            if let Ok(cached_content) = std::fs::read_to_string(&cache_file) {
                return Ok(cached_content);
            }
        }

        // Fetch remotely
        match self.download_list(url).await {
            Ok(content) => {
                // Ensure directory exists and write cache
                let _ = std::fs::create_dir_all(&self.cache_dir);
                if let Err(err) = std::fs::write(&cache_file, &content) {
                    eprintln!("Warning: Failed to write filter cache {cache_file:?}: {err}");
                }
                Ok(content)
            }
            Err(download_err) => {
                // Fallback to existing stale cache if available
                if cache_file.exists() {
                    if let Ok(stale_content) = std::fs::read_to_string(&cache_file) {
                        eprintln!(
                            "Warning: Download failed for '{url}', using stale cache: {download_err}"
                        );
                        return Ok(stale_content);
                    }
                }
                Err(download_err)
            }
        }
    }

    /// Load default filter lists (EasyList and EasyPrivacy).
    pub async fn load_default_lists(&self) -> Result<Vec<String>, ShieldError> {
        let mut lists = Vec::new();

        // 1. EasyList
        match self.get_or_fetch_list("easylist", EASYLIST_URL).await {
            Ok(content) => lists.push(content),
            Err(e) => eprintln!("Warning: Failed to load EasyList: {e}"),
        }

        // 2. EasyPrivacy
        match self.get_or_fetch_list("easyprivacy", EASYPRIVACY_URL).await {
            Ok(content) => lists.push(content),
            Err(e) => eprintln!("Warning: Failed to load EasyPrivacy: {e}"),
        }

        if lists.is_empty() {
            Err(ShieldError::FilterListError(
                "Failed to load any default filter lists".to_string(),
            ))
        } else {
            Ok(lists)
        }
    }

    /// Load default lists and all configured custom filter list URLs.
    pub async fn load_all_lists(&self) -> Result<Vec<String>, ShieldError> {
        let mut lists = self.load_default_lists().await.unwrap_or_default();

        for (idx, url) in self.custom_urls.iter().enumerate() {
            let name = format!("custom_list_{idx}");
            match self.get_or_fetch_list(&name, url).await {
                Ok(content) => lists.push(content),
                Err(e) => eprintln!("Warning: Failed to load custom filter '{url}': {e}"),
            }
        }

        if lists.is_empty() {
            Err(ShieldError::FilterListError(
                "No filter lists could be loaded".to_string(),
            ))
        } else {
            Ok(lists)
        }
    }

    /// Force update all configured filter lists, writing fresh versions to cache.
    pub async fn update_all_lists(&self) -> FilterUpdateReport {
        let mut report = FilterUpdateReport::default();
        let _ = std::fs::create_dir_all(&self.cache_dir);

        let mut targets = vec![
            ("easylist".to_string(), EASYLIST_URL.to_string()),
            ("easyprivacy".to_string(), EASYPRIVACY_URL.to_string()),
        ];

        for (idx, url) in self.custom_urls.iter().enumerate() {
            targets.push((format!("custom_list_{idx}"), url.clone()));
        }

        for (name, url) in targets {
            let cache_file = self.cache_dir.join(format!("{}.txt", sanitize_filename(&name)));
            match self.download_list(&url).await {
                Ok(content) => {
                    if let Err(err) = std::fs::write(&cache_file, &content) {
                        report
                            .failed
                            .push((url, format!("Cache write failed: {err}")));
                    } else {
                        report.updated.push(name);
                    }
                }
                Err(err) => {
                    if cache_file.exists() {
                        report.cached.push(name);
                    } else {
                        report.failed.push((url, err.to_string()));
                    }
                }
            }
        }

        report
    }
}

/// Helper to sanitize a list name into a safe filesystem filename.
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_filename() {
        assert_eq!(sanitize_filename("easylist"), "easylist");
        assert_eq!(sanitize_filename("https://foo.bar/rules.txt"), "https___foo_bar_rules_txt");
        assert_eq!(sanitize_filename("custom-list_1"), "custom-list_1");
    }

    #[test]
    fn test_cache_freshness_logic() {
        let temp_dir = std::env::temp_dir().join(format!("avalaunch_test_cache_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&temp_dir);
        let test_file = temp_dir.join("test_list.txt");

        let manager = FilterListManager::with_cache_dir(temp_dir.clone());

        // File doesn't exist
        assert!(!manager.is_cache_fresh(&test_file));

        // Empty file
        let _ = std::fs::write(&test_file, "");
        assert!(!manager.is_cache_fresh(&test_file));

        // Non-empty file
        let _ = std::fs::write(&test_file, "! Filter list\n||ad.com^\n");
        assert!(manager.is_cache_fresh(&test_file));

        // Clean up
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_filter_list_download_error_handling() {
        let manager = FilterListManager::with_cache_dir(std::env::temp_dir().join("avalaunch_err_test"));
        
        // Invalid URL should return ShieldError::DownloadError
        let res = manager.download_list("http://non-existent-domain-123456789.invalid/filters.txt").await;
        assert!(res.is_err(), "Non-existent domain download must return error");
        match res.unwrap_err() {
            ShieldError::DownloadError { url, .. } => {
                assert!(url.contains("non-existent-domain"));
            }
            other => panic!("Expected DownloadError, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_get_or_fetch_stale_cache_fallback() {
        let temp_dir = std::env::temp_dir().join(format!("avalaunch_test_fallback_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&temp_dir);
        let cache_file = temp_dir.join("fallback_test.txt");

        // Write existing cached data
        std::fs::write(&cache_file, "! Existing cached rules\n||stale-ad.com^\n").expect("write cache");

        let mut manager = FilterListManager::with_cache_dir(temp_dir.clone());
        // Set max cache age to 0 so it's always considered stale
        manager.set_max_cache_age(Duration::from_secs(0));

        // Fetch from invalid URL (download will fail, but stale cache should be returned as fallback)
        let result = manager.get_or_fetch_list("fallback_test", "http://invalid-url-domain.fail/list.txt").await;
        assert!(result.is_ok(), "Should fallback to existing cached file when download fails");
        let content = result.unwrap();
        assert!(content.contains("||stale-ad.com^"));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
