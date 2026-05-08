use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;

/// Unified clock for synchronizing video capture and audio capture timelines.
/// Both video and audio threads reference the same RecordingClock to ensure
/// their durations remain aligned throughout recording, including pause/resume cycles.
pub struct RecordingClock {
    /// The moment recording started (before any pause).
    start_time: Instant,
    /// Whether recording is currently paused.
    paused: AtomicBool,
    /// Wall-clock time when the most recent pause began (None if not paused).
    pause_start: Mutex<Option<Instant>>,
    /// Total microseconds of pause time accumulated so far.
    /// Updated when transitioning from paused→active.
    accumulated_pause_us: AtomicU64,
}

impl RecordingClock {
    pub fn new() -> Self {
        Self {
            start_time: Instant::now(),
            paused: AtomicBool::new(false),
            pause_start: Mutex::new(None),
            accumulated_pause_us: AtomicU64::new(0),
        }
    }

    /// Returns the total elapsed time since recording started, **excluding** paused intervals.
    /// This is the canonical "recording time" that both video and audio use for synchronization.
    pub fn elapsed_active_us(&self) -> u64 {
        let total_us = self.start_time.elapsed().as_micros() as u64;
        let accumulated_pause = self.accumulated_pause_us.load(Ordering::Acquire);

        let current_pause_us = if self.is_paused() {
            if let Ok(pause_start_opt) = self.pause_start.lock() {
                pause_start_opt
                    .map(|ps| ps.elapsed().as_micros() as u64)
                    .unwrap_or(0)
            } else {
                0
            }
        } else {
            0
        };

        total_us.saturating_sub(accumulated_pause).saturating_sub(current_pause_us)
    }

    /// Returns the expected number of video frames captured by now at the given FPS.
    pub fn frame_count_at(&self, fps: u32) -> u64 {
        if fps == 0 {
            return 0;
        }
        self.elapsed_active_us()
            .saturating_mul(fps as u64)
            .checked_div(1_000_000)
            .unwrap_or(0)
    }

    /// Returns the expected number of audio samples captured by now at the given sample rate.
    pub fn sample_count_at(&self, sample_rate: u32) -> u64 {
        if sample_rate == 0 {
            return 0;
        }
        self.elapsed_active_us()
            .saturating_mul(sample_rate as u64)
            .checked_div(1_000_000)
            .unwrap_or(0)
    }

    /// Mark the recording as paused or resumed.
    /// Maintains the accumulated pause duration for time calculations.
    pub fn set_paused(&self, paused: bool) {
        let was_paused = self.paused.swap(paused, Ordering::Release);

        if paused && !was_paused {
            // Transitioning from active → paused: record the pause start time.
            if let Ok(mut pause_start_opt) = self.pause_start.lock() {
                *pause_start_opt = Some(Instant::now());
            }
            tracing::debug!("Recording paused");
        } else if !paused && was_paused {
            // Transitioning from paused → active: accumulate the pause duration.
            if let Ok(mut pause_start_opt) = self.pause_start.lock() {
                if let Some(pause_start) = pause_start_opt.take() {
                    let pause_duration_us = pause_start.elapsed().as_micros() as u64;
                    let old_accumulated = self.accumulated_pause_us.fetch_add(pause_duration_us, Ordering::Release);
                    tracing::debug!(
                        "Recording resumed after {:.2} ms (total pause: {:.2} ms)",
                        pause_duration_us as f64 / 1000.0,
                        (old_accumulated + pause_duration_us) as f64 / 1000.0
                    );
                }
            }
        }
    }

    /// Returns true if the recording is currently paused.
    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::Acquire)
    }

    /// Resets the clock and all pause state (used only for testing or emergency stop).
    #[allow(dead_code)]
    pub fn reset(&self) {
        self.paused.store(false, Ordering::Release);
        if let Ok(mut pause_start_opt) = self.pause_start.lock() {
            *pause_start_opt = None;
        }
        self.accumulated_pause_us.store(0, Ordering::Release);
    }
}

impl Default for RecordingClock {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn test_elapsed_active_without_pause() {
        let clock = RecordingClock::new();
        thread::sleep(Duration::from_millis(100));
        let elapsed_us = clock.elapsed_active_us();
        // Allow 20ms tolerance for timing variations
        assert!(elapsed_us >= 80_000 && elapsed_us <= 150_000,
                "Expected ~100ms, got {:.2}ms", elapsed_us as f64 / 1000.0);
    }

    #[test]
    fn test_elapsed_active_with_pause() {
        let clock = RecordingClock::new();
        thread::sleep(Duration::from_millis(100)); // 100ms active
        clock.set_paused(true);
        thread::sleep(Duration::from_millis(100)); // 100ms paused
        clock.set_paused(false);
        thread::sleep(Duration::from_millis(100)); // 100ms active

        let elapsed_us = clock.elapsed_active_us();
        // Should be ~200ms (two 100ms active periods), not 300ms
        assert!(elapsed_us >= 180_000 && elapsed_us <= 250_000,
                "Expected ~200ms, got {:.2}ms", elapsed_us as f64 / 1000.0);
    }

    #[test]
    fn test_frame_count_alignment() {
        let clock = RecordingClock::new();
        let fps = 30u32;

        thread::sleep(Duration::from_millis(1000));
        let frames = clock.frame_count_at(fps);
        // 1 second at 30 FPS should be ~30 frames (allow ±1 for rounding)
        assert!((frames as i64 - 30).abs() <= 1,
                "Expected ~30 frames at 30 FPS, got {}", frames);
    }

    #[test]
    fn test_sample_count_alignment() {
        let clock = RecordingClock::new();
        let sample_rate = 48000u32;

        thread::sleep(Duration::from_millis(1000));
        let samples = clock.sample_count_at(sample_rate);
        // 1 second at 48kHz should be ~48000 samples (allow ±100 for OS timing variance)
        assert!((samples as i64 - 48000).abs() <= 100,
                "Expected ~48000 samples at 48kHz, got {}", samples);
    }

    #[test]
    fn test_multi_pause_resume_no_drift() {
        let clock = RecordingClock::new();
        let fps = 30u32;

        // 10 cycles of: 100ms active, 100ms paused
        for _ in 0..10 {
            thread::sleep(Duration::from_millis(100));
            clock.set_paused(true);
            thread::sleep(Duration::from_millis(100));
            clock.set_paused(false);
        }

        let frames = clock.frame_count_at(fps);
        // Total active time: 1000ms = 30 frames at 30 FPS
        assert!((frames as i64 - 30).abs() <= 1,
                "Expected ~30 frames after 10 pause cycles, got {}", frames);
    }
}
