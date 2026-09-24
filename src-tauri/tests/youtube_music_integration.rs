use avalaunch_lib::config::AppConfig;
use avalaunch_lib::shield::engine::ShieldEngine;
use std::sync::Arc;

#[test]
fn test_youtube_music_config_loading() {
    let manifest_str = include_str!("../avalaunch.json");
    let config = AppConfig::load_from_str(manifest_str).expect("Failed to parse avalaunch.json");

    assert_eq!(config.name, "Avalaunch");
    assert_eq!(config.url, "https://music.youtube.com");
    assert!(config.shield.enabled);
    assert!(config.shield.cosmetic_filtering);
    assert!(config.shield.scriptlets_enabled);
    assert_eq!(config.window.width, 1200.0);
    assert_eq!(config.window.height, 780.0);
}

#[test]
fn test_youtube_music_ad_blocking_and_allowing() {
    let easylist = include_str!("../resources/easylist.txt");
    let easyprivacy = include_str!("../resources/easyprivacy.txt");

    let engine = ShieldEngine::new(vec![easylist.to_string(), easyprivacy.to_string()])
        .expect("Failed to initialize Shield Engine with bundled lists");
    let engine = Arc::new(engine);

    // 1. Blocked: DoubleClick ads on YouTube Music
    let block_doubleclick = engine.check_request(
        "https://googleads.g.doubleclick.net/pagead/ads?client=ca-pub-12345",
        "https://music.youtube.com",
        "script",
    );
    assert!(
        block_doubleclick.matched,
        "DoubleClick ad request should be blocked"
    );

    // 2. Blocked: YouTube ad stats tracking
    let block_ad_stats = engine.check_request(
        "https://www.youtube.com/api/stats/ads?v=xyz&adformat=1_5",
        "https://music.youtube.com",
        "xhr",
    );
    assert!(
        block_ad_stats.matched,
        "YouTube ad stats request should be blocked"
    );

    // 3. Blocked: Google Analytics tracking
    let block_analytics = engine.check_request(
        "https://www.google-analytics.com/analytics.js",
        "https://music.youtube.com",
        "script",
    );
    assert!(
        block_analytics.matched,
        "Google Analytics should be blocked"
    );

    // 4. Allowed: Legitimate YouTube Music web client API calls
    let allow_browse_api = engine.check_request(
        "https://music.youtube.com/youtubei/v1/browse?prettyPrint=false",
        "https://music.youtube.com",
        "xhr",
    );
    assert!(
        !allow_browse_api.matched,
        "Legitimate browse API call should be allowed"
    );

    // 5. Allowed: Audio / Video stream chunks from googlevideo
    let allow_audio_stream = engine.check_request(
        "https://rr1---sn-4g5edn6e.googlevideo.com/videoplayback?expire=123&itag=140&source=youtube",
        "https://music.youtube.com",
        "media",
    );
    assert!(
        !allow_audio_stream.matched,
        "Legitimate audio playback stream must be allowed"
    );

    // 6. Verify blocking stats
    let stats = engine.stats();
    assert_eq!(stats.blocked_count, 3, "Expected 3 blocked requests");
    assert_eq!(stats.allowed_count, 2, "Expected 2 allowed requests");
}

#[test]
fn test_youtube_music_cosmetic_filtering_rules() {
    let easylist = include_str!("../resources/easylist.txt");
    let easyprivacy = include_str!("../resources/easyprivacy.txt");

    let engine = ShieldEngine::new(vec![easylist.to_string(), easyprivacy.to_string()])
        .expect("Failed to initialize Shield Engine");

    let cosmetic = engine.get_cosmetic_resources("https://music.youtube.com/");
    let style_block = cosmetic.to_css();

    // Verify key promo & ad container elements are hidden
    assert!(
        style_block.contains("display: none !important"),
        "Style block should contain display: none !important"
    );
    assert!(
        cosmetic
            .hide_selectors
            .iter()
            .any(|s| s.contains("ytmusic-mealbar-promo-renderer")
                || s.contains("ytmusic-upsell-dialog-renderer")
                || s.contains("player-ads")
                || s.contains("ytp-ad-module")),
        "Cosmetic resources should hide YouTube Music promo and ad elements"
    );
}

#[test]
fn test_youtube_music_engine_cache_serialization() {
    let easylist = include_str!("../resources/easylist.txt");
    let engine = ShieldEngine::new(vec![easylist.to_string()])
        .expect("Failed to initialize Shield Engine");

    let serialized = engine.serialize().expect("Engine serialization failed");
    assert!(!serialized.is_empty(), "Serialized bytes must not be empty");

    let deserialized =
        ShieldEngine::from_serialized(&serialized).expect("Deserialization failed");

    let block_check = deserialized.check_request(
        "https://googleads.g.doubleclick.net/pagead/ads",
        "https://music.youtube.com",
        "script",
    );
    assert!(
        block_check.matched,
        "Deserialized engine must correctly evaluate filter rules"
    );
}
