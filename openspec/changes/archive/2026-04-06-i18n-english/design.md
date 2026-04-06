## Context

The application UI is scattered across HTML files and TypeScript code with hardcoded Chinese strings — tooltips in `editor.html`, button labels in `clip-editor.html`, overlay prompts in `record-overlay.ts`, and page titles everywhere. There is no i18n infrastructure. The README is Chinese-only.

## Goals / Non-Goals

**Goals:**
- Extract every user-visible string (text content, tooltips, titles, alert messages, overlay prompts) into JSON locale files
- Default language: English; Chinese locale file provided as the second language
- Bilingual README with tab-based language switching
- No external i18n library — pure vanilla JS/TS

**Non-Goals:**
- Runtime language switching in the app itself (only README has a language toggle)
- RTL support
- Pluralization / interpolation in strings (flat key-value only)
- Automatic detection of system locale

## Decisions

### 1. Locale file structure

**Decision:** One JSON file per language, keyed by dot-separated scope paths (e.g., `editor.tool.rect`, `clipExport.format.mp4`).

**Alternatives considered:**
- Per-page JSON files (e.g., `editor-en.json`, `settings-en.json`) — chosen against because it makes cross-page shared strings (e.g., "Save") duplicated across files.
- Single flat key-value map with long keys (e.g., `editor_tool_rect`) — works but less organized.

**Result:** `src/locales/en.json` and `src/locales/zh.json`, both with a shared nested key structure.

### 2. I18n loader scope

**Decision:** The locale loader is a single ES module `src/scripts/i18n.ts` that:
- Loads the appropriate JSON file based on a `lang` query parameter or default (`en`)
- Exposes a `t(key)` function that returns the translated string
- Injects translated `title` and `aria-label` attributes into elements that carry `data-i18n` attributes (matching the JSON key)

**Why:** Keeps the integration minimal — HTML elements get `data-i18n="editor.tool.rect"` and the loader populates them on startup. TypeScript code calls `t("editor.tool.rect")` directly.

### 3. README bilingual structure

**Decision:** Single `README.md` with two language sections separated by `---`. A small JS snippet at the top reads `localStorage.getItem("lang")` (set by the active tab) and shows only the relevant section. Tab UI is plain HTML/CSS with `display: none` toggling.

**Why:** Avoids duplicating the entire README twice in one file; easy to maintain parity between languages.

### 4. Strings extracted from TypeScript

**Decision:** Strings that appear only in TypeScript (e.g., `alert("Both shortcuts must be set!")`, `console.error("Failed to load screenshot")`) are also externalized to JSON and accessed via `t()` in TS.

**Rationale:** Users see these messages in alerts and dev tools; they should be translatable too.

### 5. Rust tray menu externalization

**Decision:** Tray menu item labels (截图, 录屏, 设置, 退出) are stored in `AppConfig` and read by `lib.rs` at tray menu creation time. English defaults are hardcoded in Rust; Chinese values are provided via `config.json` (written there by the implementation step).

**Why:** Rust cannot easily load frontend JSON locale files at runtime. Using `AppConfig` as the locale carrier for Rust-side strings is consistent with how the app already manages configuration.

**Approach:**
- `AppConfig` gains optional fields: `tray_menu_screenshot`, `tray_menu_record`, `tray_menu_settings`, `tray_menu_quit`
- Rust reads these from `AppConfig`; if a field is absent (old config), uses the English default
- `config.json` (written at implementation time) contains the Chinese translations for these four keys

### 6. Files modified

| File | What changes |
|------|-------------|
| `src/locales/en.json` | New — all English UI strings (frontend + tray menu keys) |
| `src/locales/zh.json` | New — all Chinese UI strings |
| `src/scripts/i18n.ts` | New — locale loader + `t()` function |
| `src-tauri/src/config.rs` | Add tray menu string fields to `AppConfig` |
| `src-tauri/src/lib.rs` | Build tray menu from `AppConfig` instead of hardcoded strings |
| `src/editor.html` | Replace hardcoded Chinese `title` attrs with `data-i18n` attrs |
| `src/settings.html` | Same |
| `src/clip-editor.html` | Same |
| `src/index.html` | Same |
| `src/pin.html` | Update `<title>` via `data-i18n` |
| `src/screenshot-overlay.html` | Same |
| `src/record-overlay.html` | Replace Chinese text in `draw()` with `t()` calls |
| `src/scripts/editor.ts` | Replace alert/console strings with `t()` calls |
| `src/scripts/settings-page.ts` | Replace alert strings with `t()` calls |
| `src/scripts/record-overlay.ts` | Replace overlay text strings with `t()` calls |
| `src/scripts/clip-editor.ts` | Replace button labels and alert strings with `t()` calls |
| `README.md` | Restructure as bilingual tabbed README |

## Risks / Trade-offs

- **[Risk]** Adding `data-i18n` to many elements is verbose. → **Mitigation:** HTML is already structured with semantic elements; the addition is mechanical and bounded.
- **[Risk]** The `i18n.ts` loader runs synchronously before the app script. → **Mitigation:** Keep locale JSON small (< 50KB); load is fast.
- **[Trade-off]** TypeScript calling `t()` requires importing `i18n.ts` everywhere. → Accepted; the import is one line and the `t()` function is stateless.

## Open Questions

- Should `src/scripts/editor-tools.ts` and `src/scripts/editor-canvas.ts` also have their console.log/debug strings externalized? — Yes, include them.
