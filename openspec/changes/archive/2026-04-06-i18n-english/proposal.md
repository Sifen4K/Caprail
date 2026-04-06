## Why

The application UI is currently hardcoded in Chinese, limiting its audience and making future localization impossible. All user-facing text must be externalized to JSON configuration files, with English as the default language, so Chinese can be added later via a language switcher.

## What Changes

- Extract all hardcoded Chinese/English text from HTML and TypeScript into JSON locale files
- Replace all `title` attributes, button labels, alert messages, tooltips, overlay text, and HTML page titles with i18n key references
- Add a bilingual README with tab-based language switching (default: English)
- Create a lightweight i18n loading mechanism (no external library)
- Update all existing UI pages: editor, settings, clip-editor, index, pin, screenshot-overlay, record-overlay
- Externalize tray menu items (截图/录屏/设置/退出) from Rust `lib.rs` into `AppConfig`, with English defaults hardcoded in Rust

## Capabilities

### New Capabilities

- `i18n`: Localization infrastructure — JSON locale files per language, a loader that injects translated strings into the DOM at startup, and a language-switching mechanism for the README

### Modified Capabilities

- `app-shell`: Page `<title>` elements and tray tooltip are currently hardcoded Chinese — update to use i18n keys
- `annotation-editor`: Tool tooltips and button `title` attributes are hardcoded Chinese — update to use i18n keys
- `screen-capture`: Overlay text ("Drag to select", "Press ESC to cancel") and page title are hardcoded Chinese — update to use i18n keys
- `recording-editor`: Clip editor HTML labels (Export MP4, Export GIF, Speed, etc.) are hardcoded Chinese — update to use i18n keys

## Impact

- Frontend: All HTML files gain a `<script>` that loads the locale JSON before running app logic. TypeScript files replace string literals with i18n key lookups.
- Rust: Tray menu items moved from hardcoded strings in `lib.rs` to `AppConfig` (loaded from `config.json`), with English defaults in Rust.
- Build: No change — locale files are JSON, served as static assets.
- Breaking: `AppConfig` gains new optional string fields; existing `config.json` remains compatible (Rust uses English defaults if fields are absent).
