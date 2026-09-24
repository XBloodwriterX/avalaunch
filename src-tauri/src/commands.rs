//! Tauri IPC Commands for Avalaunch.
//!
//! Exposes strongly-typed command endpoints to the frontend webview context for:
//! - Network request evaluation against the Shield Engine (`check_url`)
//! - Domain-specific cosmetic styles and scriptlet retrieval (`get_cosmetic_resources`)
//! - Dynamic DOM class and ID generic selector matching (`get_hidden_selectors`)
//! - On-demand filter list updates (`update_filter_lists`)
//! - Shield blocking statistics querying (`get_blocking_stats`)

use std::sync::Arc;

use crate::shield::cosmetic::CosmeticResources;
use crate::shield::engine::{BlockResult, ShieldEngine, ShieldStats};
use crate::shield::filter_lists::{FilterListManager, FilterUpdateReport};

/// Check whether a network request URL should be blocked or allowed.
#[tauri::command]
pub async fn check_url(
    state: tauri::State<'_, Arc<ShieldEngine>>,
    url: String,
    source_url: String,
    request_type: String,
) -> Result<BlockResult, String> {
    Ok(state.check_request(&url, &source_url, &request_type))
}

/// Retrieve cosmetic CSS selectors and scriptlets for a given page URL.
#[tauri::command]
pub async fn get_cosmetic_resources(
    state: tauri::State<'_, Arc<ShieldEngine>>,
    page_url: String,
) -> Result<CosmeticResources, String> {
    Ok(state.get_cosmetic_resources(&page_url))
}

/// Match dynamic CSS classes and IDs against generic adblock hiding rules.
#[tauri::command]
pub async fn get_hidden_selectors(
    state: tauri::State<'_, Arc<ShieldEngine>>,
    classes: Vec<String>,
    ids: Vec<String>,
    exceptions: Option<Vec<String>>,
) -> Result<Vec<String>, String> {
    let exc = exceptions.unwrap_or_default();
    Ok(state.get_hidden_selectors(&classes, &ids, &exc))
}

/// Trigger an update of filter lists and refresh the active Shield Engine rules.
#[tauri::command]
pub async fn update_filter_lists(
    state: tauri::State<'_, Arc<ShieldEngine>>,
) -> Result<FilterUpdateReport, String> {
    let manager = FilterListManager::new().map_err(|e| e.to_string())?;
    let report = manager.update_all_lists().await;

    // Reload newly updated lists into the active engine via serialization
    if let Ok(lists) = manager.load_all_lists().await {
        if let Ok(fresh_engine) = ShieldEngine::new(lists) {
            if let Ok(serialized) = fresh_engine.serialize() {
                let _ = state.deserialize(&serialized);
            }
        }
    }

    Ok(report)
}

/// Retrieve current cumulative ad-blocking statistics.
#[tauri::command]
pub async fn get_blocking_stats(
    state: tauri::State<'_, Arc<ShieldEngine>>,
) -> Result<ShieldStats, String> {
    Ok(state.stats())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_commands_with_shield_engine() {
        let rules = vec![
            "||adservice.google.com^".to_string(),
            "music.youtube.com##.ytmusic-ad-slot".to_string(),
            "##.global-banner-ad".to_string(),
        ];

        let engine = ShieldEngine::new(rules).expect("ShieldEngine init");
        let engine = Arc::new(engine);

        // Test check_request logic
        let res = engine.check_request(
            "https://adservice.google.com/ads.js",
            "https://music.youtube.com",
            "script",
        );
        assert!(res.matched);

        // Test cosmetic resources
        let cosmetic = engine.get_cosmetic_resources("https://music.youtube.com");
        assert!(cosmetic.hide_selectors.contains(&".ytmusic-ad-slot".to_string()));

        // Test hidden selectors
        let hidden = engine.get_hidden_selectors(
            &["global-banner-ad".to_string(), "normal-element".to_string()],
            &[],
            &[],
        );
        assert_eq!(hidden, vec![".global-banner-ad".to_string()]);

        // Test stats
        let stats = engine.stats();
        assert_eq!(stats.blocked_count, 1);
        assert!(stats.cosmetic_count >= 1);
    }
}
