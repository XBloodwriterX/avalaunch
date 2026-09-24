# Filter List Management

## Overview

Avalaunch integrates community-standard ad-blocking and privacy filter lists (EasyList, EasyPrivacy, and uBlock Origin compatible rules), managing their lifecycle, synchronization, local disk caching, and fallback policies.

---

## Filter List Sources

| List | Default URL | Purpose |
|---|---|---|
| **EasyList** | `https://easylist.to/easylist/easylist.txt` | Primary ad server blocking and cosmetic element hiding |
| **EasyPrivacy** | `https://easylist.to/easylist/easyprivacy.txt` | Tracking pixels, analytics, and telemetry blocking |
| **Custom Lists** | User-configured via `avalaunch.json` | Enterprise or domain-specific custom rules |

---

## Disk Caching & Freshness Strategy

1. **Storage Location**:
   - Platform-standard user cache directory managed via `directories::ProjectDirs`:
     - Linux: `~/.cache/avalaunch/filter_lists/`
     - macOS: `~/Library/Caches/com.avalaunch.app/filter_lists/`
     - Windows: `%LOCALAPPDATA%\avalaunch\cache\filter_lists\`
2. **Freshness Policy**:
   - Filter lists remain valid for **7 days** after download.
   - If a cached list is younger than 7 days, it is loaded directly from disk without network overhead.
   - If older than 7 days, `FilterListManager` attempts an async background update via `reqwest`.
3. **Resilient Fallback**:
   - If network synchronization fails (e.g. offline boot or server outage), the engine automatically falls back to the existing disk cache or bundled embedded rules (`src-tauri/resources/`).
4. **Dynamic Update API**:
   - The frontend can trigger updates at runtime via the `update_filter_lists` IPC command.
