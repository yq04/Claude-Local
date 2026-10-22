// [INPUT]: Tauri 主窗口事件、应用私有目录和当前屏幕工作区。
// [OUTPUT]: 界面显示前恢复主窗口正常尺寸/最大化状态，并防抖保存有效尺寸。
// [POS]: 主窗口专属持久化边界；不处理浏览器窗口、账号资料或无 GUI 的额度核心。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use std::{
    fs,
    io::Read,
    sync::{mpsc, Mutex, OnceLock},
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, Position, Size, WebviewWindow};

use crate::window_state_model::{self as model, FrameSize, WindowState, WorkArea};

const STATE_FILE: &str = "window-state.json";
const SAVE_DEBOUNCE: Duration = Duration::from_millis(350);
static SAVE_TX: OnceLock<mpsc::SyncSender<()>> = OnceLock::new();

struct ManagedWindowState(Mutex<WindowState>);

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredState {
    width: f64,
    height: f64,
    maximized: bool,
}

impl From<StoredState> for WindowState {
    fn from(state: StoredState) -> Self {
        Self {
            width: state.width,
            height: state.height,
            maximized: state.maximized,
        }
    }
}

impl From<WindowState> for StoredState {
    fn from(state: WindowState) -> Self {
        Self {
            width: state.width,
            height: state.height,
            maximized: state.maximized,
        }
    }
}

fn state_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(STATE_FILE))
        .map_err(|_| "无法读取窗口状态目录。".into())
}

fn parse(contents: &str) -> Option<WindowState> {
    if contents.len() as u64 > model::STATE_FILE_LIMIT {
        return None;
    }
    let state = WindowState::from(serde_json::from_str::<StoredState>(contents).ok()?);
    model::valid_state(state).then_some(state)
}

fn load(app: &AppHandle) -> WindowState {
    let Ok(path) = state_path(app) else {
        return WindowState::default();
    };
    let Ok(meta) = fs::symlink_metadata(&path) else {
        return WindowState::default();
    };
    if !meta.is_file()
        || meta.len() > model::STATE_FILE_LIMIT
        || crate::identities::private::safe(&path).is_err()
    {
        return WindowState::default();
    }
    let Ok(file) = fs::File::open(path) else {
        return WindowState::default();
    };
    let mut contents = String::new();
    if file
        .take(model::STATE_FILE_LIMIT + 1)
        .read_to_string(&mut contents)
        .is_err()
        || contents.len() as u64 > model::STATE_FILE_LIMIT
    {
        return WindowState::default();
    }
    parse(&contents).unwrap_or_default()
}

fn save(app: &AppHandle, state: WindowState) {
    if !model::valid_state(state) {
        return;
    }
    let Ok(path) = state_path(app) else { return };
    let Some(dir) = path.parent() else { return };
    if crate::identities::private::directory(dir).is_err() {
        return;
    }
    let Ok(json) = serde_json::to_vec(&StoredState::from(state)) else {
        return;
    };
    if json.len() as u64 > model::STATE_FILE_LIMIT {
        return;
    }
    let _ = crate::identities::private::write(&path, &json);
}

fn capture(window: &WebviewWindow, flush: bool) {
    if window.label() != "main" {
        return;
    }
    let minimized = window.is_minimized().unwrap_or(false);
    if minimized && !flush {
        return;
    }
    let Some(state) = window.app_handle().try_state::<ManagedWindowState>() else {
        return;
    };
    let mut state = state
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !minimized {
        let maximized = window.is_maximized().unwrap_or(false);
        let (width, height) = window
            .inner_size()
            .map(|size| {
                let scale = window.scale_factor().unwrap_or(1.0);
                (size.width as f64 / scale, size.height as f64 / scale)
            })
            .unwrap_or((state.width, state.height));
        *state = model::capture_normal_size(*state, width, height, maximized, false);
    }
    if flush {
        save(window.app_handle(), *state);
    }
}

fn schedule_capture() {
    if let Some(sender) = SAVE_TX.get() {
        let _ = sender.try_send(());
    }
}

fn start_debounce_worker(app: &AppHandle) {
    if SAVE_TX.get().is_some() {
        return;
    }
    let (sender, receiver) = mpsc::sync_channel::<()>(1);
    if SAVE_TX.set(sender).is_err() {
        return;
    }
    let app = app.clone();
    thread::spawn(move || loop {
        match receiver.recv() {
            Ok(()) => loop {
                match receiver.recv_timeout(SAVE_DEBOUNCE) {
                    Ok(()) => {}
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        if let Some(state) = app.try_state::<ManagedWindowState>() {
                            let state = state
                                .0
                                .lock()
                                .unwrap_or_else(|poisoned| poisoned.into_inner());
                            save(&app, *state);
                        }
                        break;
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            },
            Err(_) => return,
        }
    });
}

fn primary_work_area(window: &WebviewWindow) -> Option<(WorkArea, f64)> {
    let monitor = window.primary_monitor().ok().flatten()?;
    let scale = monitor.scale_factor();
    let mut area = *monitor.work_area();

    #[cfg(windows)]
    {
        use windows_sys::Win32::{
            Foundation::RECT,
            UI::WindowsAndMessaging::{SystemParametersInfoW, SPI_GETWORKAREA},
        };
        let mut rect: RECT = unsafe { std::mem::zeroed() };
        let got_work_area = unsafe {
            SystemParametersInfoW(SPI_GETWORKAREA, 0, (&mut rect as *mut RECT).cast(), 0)
        };
        if got_work_area != 0 && rect.right > rect.left && rect.bottom > rect.top {
            area.position.x = rect.left;
            area.position.y = rect.top;
            area.size.width = (rect.right - rect.left) as u32;
            area.size.height = (rect.bottom - rect.top) as u32;
        }
    }

    Some((
        WorkArea {
            x: area.position.x as f64,
            y: area.position.y as f64,
            width: area.size.width as f64,
            height: area.size.height as f64,
        },
        scale,
    ))
}

fn frame_size(window: &WebviewWindow) -> FrameSize {
    let Ok(outer) = window.outer_size() else {
        return FrameSize {
            width: 0.0,
            height: 0.0,
        };
    };
    let Ok(inner) = window.inner_size() else {
        return FrameSize {
            width: 0.0,
            height: 0.0,
        };
    };
    FrameSize {
        width: outer.width.saturating_sub(inner.width) as f64,
        height: outer.height.saturating_sub(inner.height) as f64,
    }
}

fn restore(window: &WebviewWindow, state: WindowState) {
    if let Some((area, scale)) = primary_work_area(window) {
        let geometry = model::adapt_to_work_area(state, area, scale, frame_size(window));
        let _ = window.set_min_size(Some(LogicalSize {
            width: geometry.min_width,
            height: geometry.min_height,
        }));
        let _ = window.set_size(Size::Logical(LogicalSize {
            width: geometry.width,
            height: geometry.height,
        }));
        let _ = window.set_position(Position::Physical(PhysicalPosition {
            x: geometry.x.round().clamp(i32::MIN as f64, i32::MAX as f64) as i32,
            y: geometry.y.round().clamp(i32::MIN as f64, i32::MAX as f64) as i32,
        }));
    } else {
        let _ = window.set_size(Size::Logical(LogicalSize {
            width: state.width,
            height: state.height,
        }));
        let _ = window.center();
    }
    if state.maximized {
        let _ = window.maximize();
    }
    let _ = window.show();
}

pub fn setup(app: &AppHandle) {
    app.manage(ManagedWindowState(Mutex::new(load(app))));
    start_debounce_worker(app);
    if let Some(window) = app.get_webview_window("main") {
        let state = *app
            .state::<ManagedWindowState>()
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        restore(&window, state);
    }
}

pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() != "main" {
        return;
    }
    match event {
        tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
            let app = window.app_handle();
            if let Some(webview) = app.get_webview_window("main") {
                capture(&webview, false);
            }
            schedule_capture();
        }
        tauri::WindowEvent::CloseRequested { .. } => {
            if let Some(webview) = window.app_handle().get_webview_window("main") {
                capture(&webview, true);
            }
        }
        _ => {}
    }
}

pub fn flush(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        capture(&window, true);
    } else if let Some(state) = app.try_state::<ManagedWindowState>() {
        let state = state
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        save(app, *state);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn malformed_oversized_and_out_of_range_state_falls_back() {
        assert_eq!(parse("{"), None);
        assert_eq!(parse("{\"width\":900,\"height\":700}"), None);
        assert_eq!(
            parse("{\"width\":759,\"height\":700,\"maximized\":false}"),
            None
        );
        assert_eq!(
            parse(&" ".repeat(model::STATE_FILE_LIMIT as usize + 1)),
            None
        );
        assert_eq!(
            parse("{\"width\":900,\"height\":700,\"maximized\":true}"),
            Some(WindowState {
                width: 900.0,
                height: 700.0,
                maximized: true
            })
        );
    }
}
