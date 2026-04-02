## ADDED Requirements

### Requirement: Common GDI capture helper function
A shared helper function `gdi_capture(x: i32, y: i32, width: i32, height: i32) -> Result<Vec<u8>, String>` SHALL encapsulate the common GDI BitBlt + GetDIBits logic used by all capture commands.

#### Scenario: All capture commands use shared helper
- **WHEN** `capture_screen`, `capture_region`, or `capture_window` is invoked
- **THEN** each MUST delegate the actual screen capture to the common `gdi_capture` helper function

#### Scenario: Helper handles GDI resource cleanup
- **WHEN** the capture helper completes (success or failure)
- **THEN** all GDI resources (HDC, HBITMAP) MUST be properly released

### Requirement: No manual BGRA-to-RGBA byte swapping
The capture module SHALL NOT perform manual per-pixel BGRA→RGBA byte swapping. Color conversion MUST be handled by the PNG encoder or eliminated entirely.

#### Scenario: Captured data encoded directly to PNG
- **WHEN** a screenshot is captured
- **THEN** the raw BGRA pixel data SHALL be passed directly to the PNG encoder without manual byte manipulation

### Requirement: PNG encoding in capture pipeline
The capture module SHALL encode captured pixel data to PNG format before returning results.

#### Scenario: Capture returns PNG file path
- **WHEN** any capture command completes successfully
- **THEN** it SHALL return a file path to a PNG image, not raw pixel data
