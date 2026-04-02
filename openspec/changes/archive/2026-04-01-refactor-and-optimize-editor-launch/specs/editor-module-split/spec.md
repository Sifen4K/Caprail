## ADDED Requirements

### Requirement: Editor code split into modules
The editor.ts file SHALL be split into separate modules by responsibility.

#### Scenario: Tool rendering in separate module
- **WHEN** editor code is organized
- **THEN** all drawing functions (drawAnnotation, drawArrow, applyMosaic, applyBlur, drawStamp) MUST reside in `editor-tools.ts`

#### Scenario: Canvas interaction in separate module
- **WHEN** editor code is organized
- **THEN** mouse event handlers, coordinate helpers (getCanvasPos), and redrawAll logic MUST reside in `editor-canvas.ts`

#### Scenario: History management in separate module
- **WHEN** editor code is organized
- **THEN** undo/redo logic and annotation/redoStack management MUST reside in `editor-history.ts`

#### Scenario: Output operations in separate module
- **WHEN** editor code is organized
- **THEN** copy-to-clipboard, save-to-file, pin-to-screen, and OCR functions MUST reside in `editor-output.ts`

### Requirement: Editor entry point orchestrates modules
The main `editor.ts` file SHALL serve as the entry point that imports from sub-modules, initializes the canvas, sets up toolbar event listeners, and wires modules together.

#### Scenario: Entry point is concise
- **WHEN** editor.ts is loaded
- **THEN** it MUST import and initialize all sub-modules, and the file MUST NOT contain drawing, history, or output logic directly

### Requirement: No circular dependencies between editor modules
Editor sub-modules SHALL NOT have circular import dependencies.

#### Scenario: Dependency direction is one-way
- **WHEN** editor modules are organized
- **THEN** shared state (canvas context, annotations array, current tool) SHALL be passed via function parameters or a shared state module, not via circular imports
