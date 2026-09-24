use std::sync::Arc;

use crate::shield::engine::{BlockResult, ShieldEngine};

/// Normalizes various browser and webview resource type strings to standard adblock request types.
///
/// Maps common MIME/initiator types (e.g. `xhr`, `fetch`, `main_frame`, `iframe`, `css`) into
/// canonical types recognized by `adblock-rust`:
/// `document`, `subdocument`, `stylesheet`, `script`, `image`, `font`, `media`,
/// `xmlhttprequest`, `websocket`, `ping`, `csp_report`, `object`, or `other`.
pub fn normalize_resource_type(raw_type: &str) -> &'static str {
    let lower = raw_type.trim().to_ascii_lowercase();
    match lower.as_str() {
        "script" | "javascript" | "js" | "module" => "script",
        "image" | "img" | "imageset" | "png" | "jpg" | "jpeg" | "webp" | "gif" | "svg"
        | "ico" => "image",
        "stylesheet" | "css" | "style" => "stylesheet",
        "font" | "woff" | "woff2" | "ttf" | "otf" | "eot" => "font",
        "subdocument" | "sub_frame" | "iframe" | "frame" => "subdocument",
        "document" | "main_frame" | "page" => "document",
        "media" | "audio" | "video" | "track" | "mp3" | "mp4" | "webm" => "media",
        "xmlhttprequest" | "xhr" | "fetch" | "ajax" => "xmlhttprequest",
        "websocket" | "ws" | "wss" => "websocket",
        "ping" | "beacon" => "ping",
        "csp_report" | "csp" => "csp_report",
        "object" | "object_subrequest" | "embed" => "object",
        _ => "other",
    }
}

/// Request interceptor that coordinates network filtering decisions with [`ShieldEngine`].
#[derive(Clone)]
pub struct RequestInterceptor {
    engine: Arc<ShieldEngine>,
}

impl RequestInterceptor {
    /// Create a new RequestInterceptor wrapping a shared [`ShieldEngine`].
    pub fn new(engine: Arc<ShieldEngine>) -> Self {
        Self { engine }
    }

    /// Evaluate a webview network request and return a [`BlockResult`].
    pub fn check(&self, url: &str, source_url: &str, resource_type: &str) -> BlockResult {
        let normalized = normalize_resource_type(resource_type);
        self.engine.check_request(url, source_url, normalized)
    }

    /// Quick boolean check whether a network request should be blocked.
    pub fn should_block(&self, url: &str, source_url: &str, resource_type: &str) -> bool {
        self.check(url, source_url, resource_type).matched
    }

    /// Access the underlying [`ShieldEngine`].
    pub fn engine(&self) -> &Arc<ShieldEngine> {
        &self.engine
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_resource_type() {
        assert_eq!(normalize_resource_type("script"), "script");
        assert_eq!(normalize_resource_type("JS"), "script");
        assert_eq!(normalize_resource_type("fetch"), "xmlhttprequest");
        assert_eq!(normalize_resource_type("xhr"), "xmlhttprequest");
        assert_eq!(normalize_resource_type("iframe"), "subdocument");
        assert_eq!(normalize_resource_type("main_frame"), "document");
        assert_eq!(normalize_resource_type("css"), "stylesheet");
        assert_eq!(normalize_resource_type("unknown_custom_type"), "other");
    }

    #[test]
    fn test_request_interceptor_evaluation() {
        let rules = vec![
            "||adservice.google.com^$third-party".to_string(),
            "||telemetry.example.com^$xhr".to_string(),
        ];
        let engine = Arc::new(ShieldEngine::new(rules).expect("Engine init"));
        let interceptor = RequestInterceptor::new(engine);

        // Third-party script blocked
        assert!(interceptor.should_block(
            "https://adservice.google.com/ads.js",
            "https://music.youtube.com",
            "script"
        ));

        // Third-party xhr blocked via normalized 'fetch' type
        assert!(interceptor.should_block(
            "https://telemetry.example.com/log",
            "https://music.youtube.com",
            "fetch"
        ));

        // First party request allowed
        assert!(!interceptor.should_block(
            "https://music.youtube.com/api/v1/player",
            "https://music.youtube.com",
            "fetch"
        ));
    }
}
