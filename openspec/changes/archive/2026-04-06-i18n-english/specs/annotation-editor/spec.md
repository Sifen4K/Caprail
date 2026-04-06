## MODIFIED Requirements

### Requirement: 标注工具栏
All tool button `title` attributes in the annotation editor toolbar SHALL be loaded from the i18n locale file under the `editor.tool.*` key scope.

#### Scenario: Toolbar tooltips loaded from i18n
- **WHEN** the annotation editor opens
- **THEN** all tool button `title` attributes (rect, ellipse, arrow, pen, text, mosaic, blur, stamp) are loaded from i18n locale keys `editor.tool.*`

### Requirement: 标注撤销/重做
All action button `title` attributes in the annotation editor (undo, redo, copy, save, pin, ocr) SHALL be loaded from the i18n locale file under the `editor.action.*` key scope.

#### Scenario: Action button tooltips loaded from i18n
- **WHEN** the annotation editor opens
- **THEN** the undo, redo, copy, save, pin, and ocr button `title` attributes are loaded from `editor.action.undo`, `editor.action.redo`, `editor.action.copy`, `editor.action.save`, `editor.action.pin`, and `editor.action.ocr` respectively
