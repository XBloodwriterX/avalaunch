// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // Fix for WebKitGTK / Mesa / NVIDIA GBM buffer creation failures on Linux
        // (which causes blank/gray webview screens).
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            // SAFETY: Executed before any threads or WebKitGTK event loops are spawned.
            unsafe {
                std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            }
        }
    }

    avalaunch_lib::run();
}
