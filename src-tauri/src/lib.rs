//! Avalaunch core application library.
//!
//! Orchestrates application lifecycle, plugin initialization, Shield Engine state management,
//! Tauri IPC command dispatch, and webview window construction with cosmetic scriptlet injection.

pub mod commands;
pub mod config;
pub mod shield;

use std::sync::Arc;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use crate::commands::{
    check_url, get_blocking_stats, get_cosmetic_resources, get_hidden_selectors,
    update_filter_lists,
};
use crate::config::AppConfig;
use crate::shield::engine::ShieldEngine;
use crate::shield::filter_lists::FilterListManager;

/// Embedded fallback cosmetic injector script bundled into the application binary.
pub const INJECTOR_JS: &str = include_str!("../../dist/injector.js");

/// Embedded fallback EasyList rules for immediate cold-boot filtering.
pub const BUNDLED_EASYLIST: &str = include_str!("../resources/easylist.txt");

/// Embedded fallback EasyPrivacy rules for immediate cold-boot filtering.
pub const BUNDLED_EASYPRIVACY: &str = include_str!("../resources/easyprivacy.txt");

/// Initialize and configure the Shield Engine with bundled, cached, and custom filter rules.
fn initialize_shield_engine(config: &AppConfig) -> ShieldEngine {
    if !config.shield.enabled {
        return ShieldEngine::empty();
    }

    let mut rules = Vec::new();

    // 1. Add bundled baseline rules
    rules.push(BUNDLED_EASYLIST.to_string());
    rules.push(BUNDLED_EASYPRIVACY.to_string());

    // 2. Add custom rules defined directly in config
    if !config.shield.custom_rules.is_empty() {
        rules.push(config.shield.custom_rules.join("\n"));
    }

    // 3. Try loading cached or freshly fetched lists from FilterListManager if available
    if let Ok(manager) = FilterListManager::new() {
        let mut custom_manager = manager;
        if !config.shield.custom_filter_urls.is_empty() {
            custom_manager.set_custom_urls(config.shield.custom_filter_urls.clone());
        }

        // Attempt synchronous cache read for known lists
        let cache_dir = custom_manager.cache_dir();
        for list_name in &config.shield.filter_lists {
            let cache_file = cache_dir.join(format!("{list_name}.txt"));
            if cache_file.is_file() {
                if let Ok(cached_text) = std::fs::read_to_string(&cache_file) {
                    if !cached_text.is_empty() {
                        rules.push(cached_text);
                    }
                }
            }
        }
    }

    ShieldEngine::new(rules).unwrap_or_else(|err| {
        eprintln!("Warning: ShieldEngine initialization error: {err}. Starting with empty engine.");
        ShieldEngine::empty()
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            check_url,
            get_cosmetic_resources,
            get_hidden_selectors,
            update_filter_lists,
            get_blocking_stats,
        ])
        .setup(|app| {
            // 1. Load application configuration
            let config = AppConfig::load();

            // 2. Initialize Shield Engine
            let shield_engine = Arc::new(initialize_shield_engine(&config));

            // 3. Manage state in Tauri
            app.manage(shield_engine.clone());
            app.manage(config.clone());

            // 4. Determine target URL
            let target_url = config
                .url
                .parse::<tauri::Url>()
                .unwrap_or_else(|_| tauri::Url::parse("https://music.youtube.com").unwrap());

            // 5. Construct or configure main webview window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title(&config.name);
                let _ = window.set_size(tauri::LogicalSize::new(config.window.width, config.window.height));
                let _ = window.set_resizable(config.window.resizable);
                let _ = window.set_fullscreen(config.window.fullscreen);
                if let (Some(min_w), Some(min_h)) = (config.window.min_width, config.window.min_height) {
                    let _ = window.set_min_size(Some(tauri::LogicalSize::new(min_w, min_h)));
                }
                if config.shield.enabled && config.shield.cosmetic_filtering {
                    let _ = window.eval(INJECTOR_JS);
                }
                let _ = window.navigate(target_url);
            } else {
                let mut window_builder = WebviewWindowBuilder::new(
                    app,
                    "main",
                    WebviewUrl::External(target_url),
                )
                .title(&config.name)
                .inner_size(config.window.width, config.window.height)
                .resizable(config.window.resizable)
                .fullscreen(config.window.fullscreen)
                .transparent(config.window.transparent);

                if let (Some(min_w), Some(min_h)) = (config.window.min_width, config.window.min_height) {
                    window_builder = window_builder.min_inner_size(min_w, min_h);
                }

                // User-Agent override
                if let Some(ref ua) = config.user_agent.custom_override {
                    window_builder = window_builder.user_agent(ua);
                }

                // Inject cosmetic filtering initialization script
                if config.shield.enabled && config.shield.cosmetic_filtering {
                    window_builder = window_builder.initialization_script(INJECTOR_JS);
                }

                // Intercept navigation requests via Shield Engine
                let nav_shield = shield_engine.clone();
                window_builder = window_builder.on_navigation(move |url| {
                    let url_str = url.as_str();
                    let block_result = nav_shield.check_request(url_str, url_str, "subdocument");
                    if block_result.matched {
                        eprintln!("[Shield] Blocked top-level navigation to: {url_str}");
                        false
                    } else {
                        true
                    }
                });

                window_builder.build()?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running avalaunch application");
}
