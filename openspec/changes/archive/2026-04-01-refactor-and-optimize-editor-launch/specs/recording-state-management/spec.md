## ADDED Requirements

### Requirement: Structured recording session
All recording state SHALL be managed through a single `Mutex<Option<RecordingSession>>` where `RecordingSession` is a struct holding all session data. Separate `AtomicBool` globals for `RECORDING` and `PAUSED` MUST be eliminated.

#### Scenario: No recording active
- **WHEN** no recording is in progress
- **THEN** the session state MUST be `None`

#### Scenario: Recording active
- **WHEN** a recording is in progress
- **THEN** the session state MUST be `Some(RecordingSession)` containing all recording context (FFmpeg process, config, timing, frame count, pause state, capture thread handle)

#### Scenario: Check if recording
- **WHEN** any command needs to check recording status
- **THEN** it SHALL check whether the session `Option` is `Some` rather than reading a separate `AtomicBool`

### Requirement: Recording session encapsulates pause state
The `RecordingSession` struct SHALL include a `paused: bool` field instead of using a separate global `AtomicBool`.

#### Scenario: Pause and resume within session
- **WHEN** pause or resume is requested
- **THEN** the `paused` field on the active `RecordingSession` MUST be updated within the same mutex lock

### Requirement: Capture thread uses session-scoped stop signal
The capture thread SHALL receive a stop signal through an `Arc<AtomicBool>` owned by the `RecordingSession`, not through a process-global static.

#### Scenario: Stop signal is session-scoped
- **WHEN** a recording session starts
- **THEN** a new `Arc<AtomicBool>` for the stop signal SHALL be created and shared with the capture thread
- **THEN** the global `RECORDING` static MUST NOT exist
