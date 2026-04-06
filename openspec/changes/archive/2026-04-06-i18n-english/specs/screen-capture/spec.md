## MODIFIED Requirements

### Requirement: 区域截图
The overlay hint text displayed during screen capture selection SHALL be loaded from the i18n locale file.

#### Scenario: Overlay hint text loaded from i18n
- **WHEN** the screenshot overlay opens
- **THEN** the area selection hint text is loaded from `screenshot.selectArea` and the ESC cancel hint is loaded from `screenshot.pressEscCancel`

### Requirement: 窗口截图
The window hover highlight label SHALL format using the i18n key `screenshot.windowInfo` with substitution values `{title}`, `{width}`, and `{height}`.

#### Scenario: Window info label formatted via i18n
- **WHEN** the user hovers over a window in screenshot mode
- **THEN** the window label is formatted using `screenshot.windowInfo` key, producing text such as "Notepad (800x600)"
