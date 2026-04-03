## ADDED Requirements

### Requirement: Capture result saved as temporary PNG file
The capture commands (`capture_screen`, `capture_region`, `capture_window`) SHALL save the captured image as a PNG file in the system temporary directory and return the file path instead of raw pixel data.

#### Scenario: Screenshot captured and saved to temp file
- **WHEN** user captures a screenshot via any capture command
- **THEN** the system saves a PNG file to the temp directory and returns `{ path: string, width: u32, height: u32 }`

#### Scenario: Temp file has unique name
- **WHEN** multiple screenshots are captured in quick succession
- **THEN** each temp file MUST have a unique name (using timestamp or UUID) to prevent overwrites

### Requirement: Editor window receives image path via URL query parameter
The editor window SHALL receive the screenshot file path as a URL query parameter instead of via IPC event, consistent with the clip-editor pattern.

#### Scenario: Editor opens with image path in URL
- **WHEN** main.ts opens the editor window after capture
- **THEN** it MUST pass the temp file path as `?path=<encoded-path>` in the editor URL

#### Scenario: Editor loads image from file path
- **WHEN** editor.ts initializes
- **THEN** it SHALL read the file path from URL parameters, convert to asset URL via `convertFileSrc`, and load the image via `<img>` element into the canvas

### Requirement: No hardcoded delay for editor data loading
The editor launch flow SHALL NOT use `setTimeout` or any hardcoded delay for data transfer.

#### Scenario: Editor loads without artificial delay
- **WHEN** the editor window is created after screenshot capture
- **THEN** the image MUST be available immediately via URL parameter — no setTimeout, no event-based waiting

### Requirement: Temporary file cleanup
Temporary screenshot files SHALL be cleaned up when no longer needed.

#### Scenario: Cleanup on editor close
- **WHEN** the editor window is closed
- **THEN** the associated temporary PNG file MUST be deleted

#### Scenario: Cleanup of stale files on app start
- **WHEN** the application starts
- **THEN** any leftover temporary screenshot files from previous sessions MUST be cleaned up
