// [INPUT]: 合成逻辑尺寸、Windows 恢复态外框/装饰/DPI、屏幕工作区。
// [OUTPUT]: 有界状态校验、当前屏幕尺寸适配和居中几何；不访问 Tauri、文件或系统。
// [POS]: 主窗口状态持久化的纯规则层，供本机窗口控制器和隔离单元测试共用。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

pub const DEFAULT_WIDTH: f64 = 1040.0;
pub const DEFAULT_HEIGHT: f64 = 820.0;
pub const MIN_WIDTH: f64 = 760.0;
pub const MIN_HEIGHT: f64 = 640.0;
pub const MAX_DIMENSION: f64 = 16_384.0;
pub const STATE_FILE_LIMIT: u64 = 512;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WindowState {
    pub width: f64,
    pub height: f64,
    pub maximized: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            maximized: false,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WorkArea {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FrameSize {
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RestoredGeometry {
    pub width: f64,
    pub height: f64,
    pub x: f64,
    pub y: f64,
    pub min_width: f64,
    pub min_height: f64,
}

pub fn valid_state(state: WindowState) -> bool {
    state.width.is_finite()
        && state.height.is_finite()
        && (MIN_WIDTH..=MAX_DIMENSION).contains(&state.width)
        && (MIN_HEIGHT..=MAX_DIMENSION).contains(&state.height)
}

pub fn capture_normal_size(
    previous: WindowState,
    width: f64,
    height: f64,
    maximized: bool,
    minimized: bool,
) -> WindowState {
    if minimized {
        return previous;
    }
    let (width, height) = if maximized {
        (previous.width, previous.height)
    } else if width.is_finite()
        && height.is_finite()
        && (MIN_WIDTH..=MAX_DIMENSION).contains(&width)
        && (MIN_HEIGHT..=MAX_DIMENSION).contains(&height)
    {
        (width, height)
    } else {
        (previous.width, previous.height)
    };
    WindowState {
        width,
        height,
        maximized,
    }
}

// WINDOWPLACEMENT owns restored bounds even while the live client is maximized.
// Its outer rectangle and the normal-style frame are both physical pixels.
#[cfg(any(windows, test))]
pub fn capture_windows_placement(
    previous: WindowState,
    normal_outer: FrameSize,
    normal_frame: FrameSize,
    dpi: u32,
    maximized: bool,
    minimized: bool,
) -> WindowState {
    if minimized {
        return previous;
    }
    let mut next = WindowState {
        maximized,
        ..previous
    };
    if !(48..=768).contains(&dpi)
        || !normal_frame.width.is_finite()
        || !normal_frame.height.is_finite()
        || normal_frame.width < 0.0
        || normal_frame.height < 0.0
    {
        return next;
    }
    let scale = dpi as f64 / 96.0;
    let candidate = WindowState {
        width: (normal_outer.width - normal_frame.width) / scale,
        height: (normal_outer.height - normal_frame.height) / scale,
        maximized,
    };
    if valid_state(candidate) {
        next = candidate;
    }
    next
}

pub fn adapt_to_work_area(
    state: WindowState,
    area: WorkArea,
    scale: f64,
    frame: FrameSize,
) -> RestoredGeometry {
    let scale = if scale.is_finite() && scale >= 0.5 && scale <= 8.0 {
        scale
    } else {
        1.0
    };
    let area_width = finite_positive(area.width, DEFAULT_WIDTH * scale);
    let area_height = finite_positive(area.height, DEFAULT_HEIGHT * scale);
    let frame_width = finite_nonnegative(frame.width).min(area_width * 0.25);
    let frame_height = finite_nonnegative(frame.height).min(area_height * 0.25);
    let available_width = ((area_width - frame_width - 24.0).max(1.0) / scale).min(MAX_DIMENSION);
    let available_height =
        ((area_height - frame_height - 24.0).max(1.0) / scale).min(MAX_DIMENSION);
    let min_width = MIN_WIDTH.min(available_width);
    let min_height = MIN_HEIGHT.min(available_height);
    let width = finite_positive(state.width, DEFAULT_WIDTH).clamp(min_width, available_width);
    let height = finite_positive(state.height, DEFAULT_HEIGHT).clamp(min_height, available_height);
    let outer_width = width * scale + frame_width;
    let outer_height = height * scale + frame_height;
    let x = finite_or(area.x, 0.0) + (area_width - outer_width).max(0.0) / 2.0;
    let y = finite_or(area.y, 0.0) + (area_height - outer_height).max(0.0) / 2.0;
    RestoredGeometry {
        width,
        height,
        x,
        y,
        min_width,
        min_height,
    }
}

fn finite_positive(value: f64, fallback: f64) -> f64 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        fallback
    }
}

fn finite_nonnegative(value: f64) -> f64 {
    if value.is_finite() && value >= 0.0 {
        value
    } else {
        0.0
    }
}

fn finite_or(value: f64, fallback: f64) -> f64 {
    if value.is_finite() {
        value
    } else {
        fallback
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_or_unbounded_state() {
        assert!(valid_state(WindowState::default()));
        for state in [
            WindowState {
                width: f64::NAN,
                height: 820.0,
                maximized: false,
            },
            WindowState {
                width: 760.0,
                height: f64::INFINITY,
                maximized: false,
            },
            WindowState {
                width: 759.0,
                height: 640.0,
                maximized: false,
            },
            WindowState {
                width: 760.0,
                height: 16_385.0,
                maximized: false,
            },
        ] {
            assert!(!valid_state(state));
        }
    }

    #[test]
    fn maximized_and_minimized_capture_preserve_normal_dimensions() {
        let previous = WindowState {
            width: 1100.0,
            height: 700.0,
            maximized: false,
        };
        assert_eq!(
            capture_normal_size(previous, 1920.0, 1080.0, true, false),
            WindowState {
                maximized: true,
                ..previous
            }
        );
        assert_eq!(
            capture_normal_size(previous, 400.0, 300.0, false, true),
            previous
        );
        assert_eq!(
            capture_normal_size(previous, 900.0, 650.0, false, false),
            WindowState {
                width: 900.0,
                height: 650.0,
                maximized: false
            }
        );
    }

    #[test]
    fn windows_placement_ignores_maximize_transition_client_size_and_cached_flag() {
        // A move callback can see the old Tauri flag and the new maximized client.
        let cached_maximized = false;
        let current_client = (2560.0, 1369.0);
        assert_eq!(
            capture_normal_size(
                WindowState::default(),
                current_client.0,
                current_client.1,
                cached_maximized,
                false,
            )
            .width,
            2560.0
        );
        // Windows still retains the correct restored outer rect at 150% DPI.
        let normal_outer = FrameSize {
            width: 1488.0,
            height: 1227.0,
        };
        let normal_frame = FrameSize {
            width: 24.0,
            height: 57.0,
        };
        for os_maximized in [false, true] {
            assert_eq!(
                capture_windows_placement(
                    WindowState::default(),
                    normal_outer,
                    normal_frame,
                    144,
                    os_maximized,
                    false,
                ),
                WindowState {
                    width: 976.0,
                    height: 780.0,
                    maximized: os_maximized,
                }
            );
        }
    }

    #[test]
    fn windows_placement_preserves_previous_dimensions_for_minimized_or_invalid_bounds() {
        let previous = WindowState {
            width: 976.0,
            height: 780.0,
            maximized: true,
        };
        let outer = FrameSize {
            width: 992.0,
            height: 818.0,
        };
        let frame = FrameSize {
            width: 16.0,
            height: 38.0,
        };
        assert_eq!(
            capture_windows_placement(previous, outer, frame, 96, false, true),
            previous
        );
        for dpi in [0, 96] {
            assert_eq!(
                capture_windows_placement(previous, frame, frame, dpi, true, false),
                previous
            );
        }
    }

    #[test]
    fn centers_in_negative_coordinate_work_area_and_scales_logical_size() {
        let result = adapt_to_work_area(
            WindowState {
                width: 1040.0,
                height: 820.0,
                maximized: false,
            },
            WorkArea {
                x: -1920.0,
                y: 0.0,
                width: 1920.0,
                height: 1040.0,
            },
            1.5,
            FrameSize {
                width: 16.0,
                height: 39.0,
            },
        );
        assert_eq!(result.width, 1040.0);
        assert_eq!(result.height, 651.3333333333334);
        assert!(result.x >= -1920.0);
        assert!(result.y >= 0.0);
        assert!(result.x + result.width * 1.5 + 16.0 <= 0.0);
        assert!(result.y + result.height * 1.5 + 39.0 <= 1040.0);
    }

    #[test]
    fn clamps_oversized_window_and_relaxes_minimum_for_tiny_screen() {
        let result = adapt_to_work_area(
            WindowState {
                width: 5000.0,
                height: 4000.0,
                maximized: false,
            },
            WorkArea {
                x: 0.0,
                y: 0.0,
                width: 680.0,
                height: 560.0,
            },
            1.0,
            FrameSize {
                width: 12.0,
                height: 36.0,
            },
        );
        assert_eq!(result.width, 644.0);
        assert_eq!(result.height, 500.0);
        assert_eq!(result.min_width, result.width);
        assert_eq!(result.min_height, result.height);
        assert!(result.x >= 0.0 && result.y >= 0.0);
    }
}
