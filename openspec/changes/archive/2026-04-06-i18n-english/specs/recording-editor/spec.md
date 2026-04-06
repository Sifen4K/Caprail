## MODIFIED Requirements

### Requirement: 录屏预览
The clip editor page title and all visible control labels SHALL be loaded from the i18n locale file under the `clipEditor.*` key scope.

#### Scenario: Clip editor labels loaded from i18n
- **WHEN** the clip editor opens
- **THEN** the page title, play button, speed label, Export MP4 button, and Export GIF button labels are loaded from `clipEditor.title`, `clipEditor.play`, `clipEditor.speed`, `clipEditor.exportMp4`, and `clipEditor.exportGif` respectively
