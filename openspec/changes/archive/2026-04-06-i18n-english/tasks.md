## 1. Locale files

- [x] 1.1 Create `src/locales/en.json` with all English UI strings organized by scope
- [x] 1.2 Create `src/locales/zh.json` with all Chinese UI strings (copy of existing Chinese text, structured by same keys)
- [x] 1.3 Add `tray_menu_screenshot`, `tray_menu_record`, `tray_menu_settings`, `tray_menu_quit` keys to both locale files

## 2. Rust tray menu externalization

- [x] 2.1 Add `tray_menu_screenshot`, `tray_menu_record`, `tray_menu_settings`, `tray_menu_quit` fields to `AppConfig` in `src-tauri/src/config.rs`
- [x] 2.2 Update `lib.rs` to build tray menu using values from `AppConfig` instead of hardcoded strings
- [x] 2.3 Add language selector to settings page and write tray menu strings to `config.json` based on selected language

## 3. I18n loader

- [x] 3.1 Create `src/scripts/i18n.ts` — `t(key)` function that returns locale string
- [x] 3.2 I18n loader injects `title`/`aria-label` into `data-i18n` elements on load
- [x] 3.3 Verify `i18n.ts` loads without errors in all pages (editor, settings, clip-editor, index, pin, screenshot-overlay)

## 4. Editor page (`src/editor.html`)

- [x] 4.1 Replace all Chinese `title` attributes with `data-i18n` attributes on tool buttons
- [x] 4.2 Replace Chinese `title` on color picker, line width, font size inputs
- [x] 4.3 Replace Chinese `title` on action buttons (undo, redo, copy, save, pin, OCR)
- [x] 4.4 Replace Chinese text in OCR panel (header, copy button, close button)
- [x] 4.5 Replace Chinese `title` attributes in `src/scripts/editor-tools.ts` stamp menu buttons (via `data-i18n` in HTML)

## 5. Settings page (`src/settings.html` + `src/scripts/settings-page.ts`)

- [x] 5.1 Replace Chinese labels in `settings.html` with `data-i18n` attributes
- [x] 5.2 Replace Chinese `alert()` messages in `settings-page.ts` with `t()` calls (already in English)
- [x] 5.3 Replace Chinese placeholder text in shortcut inputs (already in English)

## 6. Clip editor (`src/clip-editor.html` + `src/scripts/clip-editor.ts`)

- [x] 6.1 Replace Chinese labels in `clip-editor.html` with `data-i18n` attributes (already in English)
- [x] 6.2 Replace Chinese labels in speed select, export buttons, play button in `clip-editor.ts` (already in English)
- [x] 6.3 Update `clip-editor.ts` to use `t()` for any Chinese strings (none found)

## 7. Index page (`src/index.html`)

- [x] 7.1 Replace Chinese title and status text with `data-i18n` attributes (already in English)

## 8. Pin window (`src/pin.html`)

- [x] 8.1 Replace Chinese page title with `data-i18n` attribute (already in English)

## 9. Screenshot overlay (`src/screenshot-overlay.html`)

- [x] 9.1 Replace Chinese page title with `data-i18n` attribute (already in English)

## 10. Record overlay (`src/scripts/record-overlay.ts`)

- [x] 10.1 Replace Chinese `draw()` text strings with `t()` calls ("Drag to select recording area", "Press ESC to cancel")

## 11. Editor TypeScript strings (`src/scripts/editor.ts`)

- [x] 11.1 Replace any `alert()` or `console.error()` Chinese strings with `t()` calls (none found, already in English)

## 12. README bilingual

- [x] 12.1 Restructure `README.md` to have English section first, Chinese section second, separated by `---`
- [x] 12.2 Create `docs/readme.html` with tab-based HTML/CSS language switcher that toggles visibility and stores preference in `localStorage`
- [x] 12.3 Ensure English is shown by default when no preference is stored
