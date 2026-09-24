# Application Configuration

## Overview

Avalaunch uses a declarative JSON manifest (`avalaunch.json`) to define application behavior, wrapped URL targets, window geometry, Shield Engine rules, and User-Agent preferences.

---

## Schema Reference

```json
{
  "$schema": "./schema/avalaunch.schema.json",
  "name": "Avalaunch",
  "url": "https://music.youtube.com",
  "window": {
    "width": 1200,
    "height": 780,
    "min_width": 400,
    "min_height": 300,
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
    "custom_filter_urls": [],
    "cosmetic_filtering": true,
    "scriptlets_enabled": true,
    "custom_rules": []
  },
  "user_agent": {
    "override": null,
    "append_app_name": true
  }
}
```

---

## Configuration Fields

### `window` Options
- **`width` / `height`**: Initial window dimensions in logical pixels.
- **`min_width` / `min_height`**: Minimum allowed resize boundary.
- **`resizable`**: Boolean flag controlling user resize capability.
- **`fullscreen`**: Start application in fullscreen mode.
- **`title_bar`**: Enables native OS title bar decorations.
- **`transparent`**: Window background transparency.

### `shield` Options
- **`enabled`**: Master toggle for ad-blocking and privacy features.
- **`filter_lists`**: Array of standard lists to enable (`easylist`, `easyprivacy`).
- **`custom_filter_urls`**: Additional remote filter list URLs.
- **`cosmetic_filtering`**: Enable DOM element hiding via CSS injection.
- **`scriptlets_enabled`**: Enable execution of anti-circumvention scriptlets.
- **`custom_rules`**: Direct array of ABP-syntax rule strings.

### `user_agent` Options
- **`override`**: Custom User-Agent string (or `null` to use platform default).
- **`append_app_name`**: Append `Avalaunch/<version>` to the webview User-Agent.
