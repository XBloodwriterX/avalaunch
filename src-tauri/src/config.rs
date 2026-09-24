//! Application configuration system for Avalaunch.
//!
//! Loads, parses, and provides defaults for `avalaunch.json` declarative configuration,
//! including window geometry, Shield Engine rules, and User-Agent preferences.

use std::fs;
use std::path::{Path, PathBuf};

use directories::ProjectDirs;
use serde::{Deserialize, Serialize};

/// Window configuration parameters.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WindowConfig {
    /// Window width in logical pixels.
    #[serde(default = "default_width")]
    pub width: f64,

    /// Window height in logical pixels.
    #[serde(default = "default_height")]
    pub height: f64,

    /// Minimum window width in logical pixels.
    #[serde(default = "default_min_width")]
    pub min_width: Option<f64>,

    /// Minimum window height in logical pixels.
    #[serde(default = "default_min_height")]
    pub min_height: Option<f64>,

    /// Whether the window is resizable by the user.
    #[serde(default = "default_true")]
    pub resizable: bool,

    /// Whether the window starts in fullscreen mode.
    #[serde(default)]
    pub fullscreen: bool,

    /// Whether the standard native title bar is shown.
    #[serde(default)]
    pub title_bar: bool,

    /// Whether the window background is transparent.
    #[serde(default)]
    pub transparent: bool,
}

fn default_width() -> f64 {
    1200.0
}

fn default_height() -> f64 {
    780.0
}

fn default_min_width() -> Option<f64> {
    Some(400.0)
}

fn default_min_height() -> Option<f64> {
    Some(300.0)
}

fn default_true() -> bool {
    true
}

impl Default for WindowConfig {
    fn default() -> Self {
        Self {
            width: default_width(),
            height: default_height(),
            min_width: default_min_width(),
            min_height: default_min_height(),
            resizable: true,
            fullscreen: false,
            title_bar: false,
            transparent: false,
        }
    }
}

/// Shield engine ad-blocking and privacy configuration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ShieldConfig {
    /// Whether ad and tracker blocking is enabled globally.
    #[serde(default = "default_true")]
    pub enabled: bool,

    /// Standard filter list identifiers to load (e.g. "easylist", "easyprivacy").
    #[serde(default = "default_filter_lists")]
    pub filter_lists: Vec<String>,

    /// Custom remote filter list URLs to download and subscribe to.
    #[serde(default)]
    pub custom_filter_urls: Vec<String>,

    /// Whether cosmetic CSS selector injection is enabled.
    #[serde(default = "default_true")]
    pub cosmetic_filtering: bool,

    /// Whether anti-circumvention scriptlet execution is enabled.
    #[serde(default = "default_true")]
    pub scriptlets_enabled: bool,

    /// Custom Adblock Plus / uBlock Origin rule strings defined directly in config.
    #[serde(default)]
    pub custom_rules: Vec<String>,
}

fn default_filter_lists() -> Vec<String> {
    vec!["easylist".to_string(), "easyprivacy".to_string()]
}

impl Default for ShieldConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            filter_lists: default_filter_lists(),
            custom_filter_urls: Vec::new(),
            cosmetic_filtering: true,
            scriptlets_enabled: true,
            custom_rules: Vec::new(),
        }
    }
}

/// User-Agent header and spoofing configuration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UserAgentConfig {
    /// Custom User-Agent string override, or `None` to use webview default.
    #[serde(rename = "override", default)]
    pub custom_override: Option<String>,

    /// Whether to append "Avalaunch/{version}" to the User-Agent header.
    #[serde(default = "default_true")]
    pub append_app_name: bool,
}

impl Default for UserAgentConfig {
    fn default() -> Self {
        Self {
            custom_override: None,
            append_app_name: true,
        }
    }
}

impl UserAgentConfig {
    /// Resolve the final User-Agent string, applying override or suffix if configured.
    pub fn resolve_user_agent(&self, base_user_agent: Option<&str>) -> Option<String> {
        if let Some(ref custom) = self.custom_override {
            return Some(custom.clone());
        }
        if self.append_app_name {
            if let Some(base) = base_user_agent {
                return Some(format!("{base} Avalaunch/0.1.0"));
            }
        }
        None
    }
}

/// Root Avalaunch application configuration parsed from `avalaunch.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AppConfig {
    /// Optional JSON schema reference.
    #[serde(rename = "$schema", default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,

    /// Human-readable application title.
    #[serde(default = "default_name")]
    pub name: String,

    /// Target remote or local URL to load in the main webview.
    #[serde(default = "default_url")]
    pub url: String,

    /// Window geometry and display preferences.
    #[serde(default)]
    pub window: WindowConfig,

    /// Shield Engine ad-blocking preferences.
    #[serde(default)]
    pub shield: ShieldConfig,

    /// User-Agent header settings.
    #[serde(default)]
    pub user_agent: UserAgentConfig,
}

fn default_name() -> String {
    "Avalaunch".to_string()
}

fn default_url() -> String {
    "https://music.youtube.com".to_string()
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            schema: None,
            name: default_name(),
            url: default_url(),
            window: WindowConfig::default(),
            shield: ShieldConfig::default(),
            user_agent: UserAgentConfig::default(),
        }
    }
}

impl AppConfig {
    /// Load configuration from `avalaunch.json` by probing candidate locations,
    /// falling back gracefully to `AppConfig::default()` if no file exists or if parsing fails.
    pub fn load() -> Self {
        let candidates = Self::candidate_paths();
        for path in &candidates {
            if path.is_file() {
                match Self::load_from_path(path) {
                    Ok(config) => {
                        return config;
                    }
                    Err(err) => {
                        eprintln!(
                            "Warning: Failed to parse configuration at {:?}: {err}. Using default configuration.",
                            path
                        );
                    }
                }
            }
        }
        Self::default()
    }

    /// Load and deserialize `AppConfig` from a specific filesystem path.
    pub fn load_from_path(path: impl AsRef<Path>) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let content = fs::read_to_string(path)?;
        let config: Self = serde_json::from_str(&content)?;
        Ok(config)
    }

    /// Parse `AppConfig` directly from a JSON string.
    pub fn load_from_str(json_str: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json_str)
    }

    /// Returns candidate paths to locate `avalaunch.json` in priority order.
    pub fn candidate_paths() -> Vec<PathBuf> {
        let mut paths = Vec::new();

        // 1. Explicit environment variable override
        if let Ok(env_path) = std::env::var("AVALAUNCH_CONFIG") {
            paths.push(PathBuf::from(env_path));
        }

        // 2. Current working directory
        if let Ok(cwd) = std::env::current_dir() {
            paths.push(cwd.join("avalaunch.json"));
            paths.push(cwd.join("src-tauri").join("avalaunch.json"));
            if let Some(parent) = cwd.parent() {
                paths.push(parent.join("avalaunch.json"));
                paths.push(parent.join("src-tauri").join("avalaunch.json"));
            }
        }

        // 3. Executable directory
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                paths.push(exe_dir.join("avalaunch.json"));
                paths.push(exe_dir.join("resources").join("avalaunch.json"));
                if let Some(parent) = exe_dir.parent() {
                    paths.push(parent.join("avalaunch.json"));
                    paths.push(parent.join("Resources").join("avalaunch.json"));
                }
            }
        }

        // 4. Standard platform configuration directory
        if let Some(proj_dirs) = ProjectDirs::from("com", "avalaunch", "Avalaunch") {
            paths.push(proj_dirs.config_dir().join("avalaunch.json"));
        }

        paths
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = AppConfig::default();
        assert_eq!(config.name, "Avalaunch");
        assert_eq!(config.url, "https://music.youtube.com");
        assert_eq!(config.window.width, 1200.0);
        assert_eq!(config.window.height, 780.0);
        assert_eq!(config.window.min_width, Some(400.0));
        assert_eq!(config.window.min_height, Some(300.0));
        assert!(config.window.resizable);
        assert!(!config.window.fullscreen);
        assert!(config.shield.enabled);
        assert!(config.shield.cosmetic_filtering);
        assert!(config.shield.scriptlets_enabled);
        assert_eq!(
            config.shield.filter_lists,
            vec!["easylist".to_string(), "easyprivacy".to_string()]
        );
        assert_eq!(config.user_agent.custom_override, None);
        assert!(config.user_agent.append_app_name);
    }

    #[test]
    fn test_parse_architecture_schema_json() {
        let json_data = r#"{
            "$schema": "./schema/avalaunch.schema.json",
            "name": "Avalaunch Custom",
            "url": "https://music.youtube.com",
            "window": {
                "width": 1400,
                "height": 900,
                "min_width": 500,
                "min_height": 400,
                "resizable": true,
                "fullscreen": false,
                "title_bar": false,
                "transparent": false
            },
            "shield": {
                "enabled": true,
                "filter_lists": [
                    "easylist",
                    "easyprivacy"
                ],
                "custom_filter_urls": [
                    "https://example.com/custom_rules.txt"
                ],
                "cosmetic_filtering": true,
                "scriptlets_enabled": true,
                "custom_rules": [
                    "||ads.example.com^"
                ]
            },
            "user_agent": {
                "override": "CustomAgent/1.0",
                "append_app_name": false
            }
        }"#;

        let config = AppConfig::load_from_str(json_data).expect("Must parse valid JSON");
        assert_eq!(config.name, "Avalaunch Custom");
        assert_eq!(config.url, "https://music.youtube.com");
        assert_eq!(config.window.width, 1400.0);
        assert_eq!(config.window.height, 900.0);
        assert_eq!(config.window.min_width, Some(500.0));
        assert_eq!(config.window.min_height, Some(400.0));
        assert_eq!(config.shield.custom_filter_urls.len(), 1);
        assert_eq!(config.shield.custom_rules.len(), 1);
        assert_eq!(
            config.user_agent.custom_override,
            Some("CustomAgent/1.0".to_string())
        );
        assert!(!config.user_agent.append_app_name);
    }

    #[test]
    fn test_partial_json_fallback_defaults() {
        let json_data = r#"{
            "url": "https://example.com"
        }"#;

        let config = AppConfig::load_from_str(json_data).expect("Must parse partial JSON");
        assert_eq!(config.name, "Avalaunch");
        assert_eq!(config.url, "https://example.com");
        assert_eq!(config.window.width, 1200.0);
        assert!(config.shield.enabled);
        assert_eq!(config.shield.filter_lists.len(), 2);
    }

    #[test]
    fn test_user_agent_resolution() {
        let ua_config_override = UserAgentConfig {
            custom_override: Some("MyBrowser/1.0".to_string()),
            append_app_name: true,
        };
        assert_eq!(
            ua_config_override.resolve_user_agent(Some("Mozilla/5.0")),
            Some("MyBrowser/1.0".to_string())
        );

        let ua_config_append = UserAgentConfig {
            custom_override: None,
            append_app_name: true,
        };
        assert_eq!(
            ua_config_append.resolve_user_agent(Some("Mozilla/5.0")),
            Some("Mozilla/5.0 Avalaunch/0.1.0".to_string())
        );

        let ua_config_default = UserAgentConfig {
            custom_override: None,
            append_app_name: false,
        };
        assert_eq!(
            ua_config_default.resolve_user_agent(Some("Mozilla/5.0")),
            None
        );
    }
}
