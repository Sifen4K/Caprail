## Purpose

This specification defines the internationalization (i18n) system for Caprail, supporting English and Chinese languages with externalized locale files and a runtime loader module.

## Requirements

### Requirement: Locale file structure
The system SHALL provide locale files as JSON with nested dot-separated keys grouping strings by UI scope (e.g., `editor.tool.rect`, `settings.screenshotShortcut`). Supported languages: English (`en`), Chinese (`zh`).

#### Scenario: Locale file loading
- **WHEN** the application starts a window
- **THEN** it loads `src/locales/en.json` by default or `src/locales/zh.json` if `?lang=zh` is present in the URL

### Requirement: I18n loader module
The system SHALL provide an ES module `src/scripts/i18n.ts` that exposes a `t(key)` function returning the translated string for a given dot-separated key. The loader SHALL inject translated `title` and `aria-label` attributes into elements with `data-i18n` attributes on startup.

#### Scenario: Data attribute injection
- **WHEN** an element has `data-i18n="editor.tool.rect"`
- **THEN** after locale loading, its `title` attribute is set to the value of `editor.tool.rect` in the active locale JSON

#### Scenario: Direct t() call
- **WHEN** TypeScript code calls `t("settings.screenshotShortcut")`
- **THEN** it receives the corresponding translated string for the active locale

### Requirement: README bilingual switching
The `README.md` SHALL contain two language sections separated by `---`. A tab-based switcher at the top SHALL toggle visibility of each section using `localStorage` to persist the selected language preference. Default language SHALL be English.

#### Scenario: Language tab click
- **WHEN** user clicks the "中文" tab
- **THEN** the Chinese section is shown and `localStorage.setItem("lang", "zh")` is called

#### Scenario: Default language
- **WHEN** user opens README with no stored language preference
- **THEN** the English section is shown by default
