// [INPUT]: 应用私有数据目录（%APPDATA%/ai.local.claude-local）、前端主题/强调色/字体/五层光学毛玻璃偏好及经过内存降采样的自定义壁纸 Data URI。
// [OUTPUT]: 原生外观偏好与自定义壁纸的受限白名单校验、Win32 私有 ACL 原子落盘（ui-appearance.json / ui-wallpaper.json）、主窗口原生标题栏明暗主题同步及 Tauri IPC 读写命令。
// [POS]: 界面外观与自定义壁纸的 Rust 原生持久化边界；绝不保存本地磁盘文件路径或凭据，拒绝任意外部 URL 与超限载荷。
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use std::{fs, io::Read, path::Path, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Theme};

const APPEARANCE_FILE: &str = "ui-appearance.json";
const WALLPAPER_FILE: &str = "ui-wallpaper.json";
pub const APPEARANCE_FILE_LIMIT: u64 = 4096;
pub const WALLPAPER_FILE_LIMIT: u64 = 3_145_728;
pub const WALLPAPER_DATA_URL_LIMIT: usize = 2_600_000;

const VALID_THEMES: &[&str] = &["system", "light", "dark"];
const VALID_ACCENTS: &[&str] = &["terracotta", "cockpit", "emerald", "violet", "rose", "amber"];
const VALID_SIDEBARS: &[&str] = &["classic", "compact"];
const VALID_SURFACES: &[&str] = &["cockpit", "glass", "hatched"];
const VALID_BACKDROPS: &[&str] = &[
    "minimal", "aurora", "sunset", "ocean", "nebula", "dune", "fuji", "custom",
];
const VALID_FONTS: &[&str] = &["system", "modern", "humanist", "serif"];
const VALID_MONO_FONTS: &[&str] = &["cascadia", "jetbrains", "consolas"];
const VALID_QUOTA_DISPLAYS: &[&str] = &["remaining", "used"];
const VALID_UI_SCALES: &[u16] = &[90, 95, 100, 105, 110];
const VALID_STARTUP_PAGES: &[&str] = &[
    "remember", "quick", "cleaner", "usage", "browser", "system", "vps", "help", "settings",
];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UiAppearanceDto {
    pub theme: String,
    pub accent: String,
    pub reduce_motion: bool,
    pub sidebar_layout: String,
    pub surface_style: String,
    pub backdrop: String,
    pub glass_blur: u8,
    pub glass_opacity: u8,
    pub wallpaper_dim: u8,
    pub font_family: String,
    pub mono_font: String,
    pub quota_display: String,
    pub ui_scale: u16,
    pub startup_page: String,
}

impl Default for UiAppearanceDto {
    fn default() -> Self {
        Self {
            theme: "light".into(),
            accent: "terracotta".into(),
            reduce_motion: false,
            sidebar_layout: "classic".into(),
            surface_style: "cockpit".into(),
            backdrop: "minimal".into(),
            glass_blur: 22,
            glass_opacity: 72,
            wallpaper_dim: 15,
            font_family: "system".into(),
            mono_font: "cascadia".into(),
            quota_display: "remaining".into(),
            ui_scale: 100,
            startup_page: "remember".into(),
        }
    }
}

impl UiAppearanceDto {
    pub fn sanitized(mut self) -> Self {
        let def = Self::default();
        if !VALID_THEMES.contains(&self.theme.as_str()) {
            self.theme = def.theme;
        }
        if !VALID_ACCENTS.contains(&self.accent.as_str()) {
            self.accent = def.accent;
        }
        if !VALID_SIDEBARS.contains(&self.sidebar_layout.as_str()) {
            self.sidebar_layout = def.sidebar_layout;
        }
        if !VALID_SURFACES.contains(&self.surface_style.as_str()) {
            self.surface_style = def.surface_style;
        }
        if !VALID_BACKDROPS.contains(&self.backdrop.as_str()) {
            self.backdrop = def.backdrop;
        }
        self.glass_blur = self.glass_blur.clamp(8, 40);
        self.glass_opacity = self.glass_opacity.clamp(45, 92);
        self.wallpaper_dim = self.wallpaper_dim.clamp(0, 65);
        if !VALID_FONTS.contains(&self.font_family.as_str()) {
            self.font_family = def.font_family;
        }
        if !VALID_MONO_FONTS.contains(&self.mono_font.as_str()) {
            self.mono_font = def.mono_font;
        }
        if !VALID_QUOTA_DISPLAYS.contains(&self.quota_display.as_str()) {
            self.quota_display = def.quota_display;
        }
        if !VALID_UI_SCALES.contains(&self.ui_scale) {
            self.ui_scale = def.ui_scale;
        }
        if !VALID_STARTUP_PAGES.contains(&self.startup_page.as_str()) {
            self.startup_page = def.startup_page;
        }
        self
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiWallpaperDto {
    pub data_url: String,
    pub suggested_accent: String,
    pub width: u32,
    pub height: u32,
    pub updated_at: u64,
}

pub fn valid_wallpaper_data_url(data_url: &str) -> bool {
    if data_url.is_empty() || data_url.len() > WALLPAPER_DATA_URL_LIMIT {
        return false;
    }
    if data_url.chars().any(char::is_control) {
        return false;
    }
    let allowed_prefix = [
        "data:image/webp;base64,",
        "data:image/jpeg;base64,",
        "data:image/png;base64,",
        "data:image/gif;base64,",
        "data:image/svg+xml;",
        "data:image/svg+xml,",
    ]
    .iter()
    .any(|prefix| data_url.starts_with(prefix));
    if !allowed_prefix {
        return false;
    }
    let lower = data_url.to_ascii_lowercase();
    !lower.contains("file://") && !lower.contains("http://") && !lower.contains("https://")
}

impl UiWallpaperDto {
    pub fn validated(mut self) -> Result<Self, String> {
        if !valid_wallpaper_data_url(&self.data_url) {
            return Err("settings.wallpaperInvalid".into());
        }
        if !VALID_ACCENTS.contains(&self.suggested_accent.as_str()) {
            self.suggested_accent = "terracotta".into();
        }
        self.width = self.width.clamp(1, 7680);
        self.height = self.height.clamp(1, 4320);
        Ok(self)
    }
}

pub struct UiAppearanceState {
    pub appearance: Mutex<Option<UiAppearanceDto>>,
    pub wallpaper: Mutex<Option<UiWallpaperDto>>,
}

fn read_bounded_file(path: &Path, limit: u64) -> Option<String> {
    let meta = fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() > limit || crate::identities::private::safe(path).is_err() {
        return None;
    }
    let file = fs::File::open(path).ok()?;
    let mut contents = String::new();
    if file
        .take(limit + 1)
        .read_to_string(&mut contents)
        .is_err()
        || contents.len() as u64 > limit
    {
        return None;
    }
    Some(contents)
}

pub fn read_appearance_from_path(path: &Path) -> Option<UiAppearanceDto> {
    let contents = read_bounded_file(path, APPEARANCE_FILE_LIMIT)?;
    let parsed = serde_json::from_str::<UiAppearanceDto>(&contents).ok()?;
    Some(parsed.sanitized())
}

pub fn write_appearance_to_dir(dir: &Path, prefs: &UiAppearanceDto) -> Result<UiAppearanceDto, String> {
    crate::identities::private::directory(dir)?;
    let sanitized = prefs.clone().sanitized();
    let bytes = serde_json::to_vec(&sanitized).map_err(|_| "无法保存界面外观偏好。".to_string())?;
    if bytes.len() as u64 > APPEARANCE_FILE_LIMIT {
        return Err("无法保存界面外观偏好。".into());
    }
    crate::identities::private::write(&dir.join(APPEARANCE_FILE), &bytes)?;
    Ok(sanitized)
}

pub fn read_wallpaper_from_path(path: &Path) -> Option<UiWallpaperDto> {
    let contents = read_bounded_file(path, WALLPAPER_FILE_LIMIT)?;
    let parsed = serde_json::from_str::<UiWallpaperDto>(&contents).ok()?;
    parsed.validated().ok()
}

pub fn write_wallpaper_to_dir(dir: &Path, wallpaper: &UiWallpaperDto) -> Result<UiWallpaperDto, String> {
    let validated = wallpaper.clone().validated()?;
    crate::identities::private::directory(dir)?;
    let bytes = serde_json::to_vec(&validated).map_err(|_| "settings.wallpaperReadFailed".to_string())?;
    if bytes.len() as u64 > WALLPAPER_FILE_LIMIT {
        return Err("settings.wallpaperInvalid".into());
    }
    crate::identities::private::write(&dir.join(WALLPAPER_FILE), &bytes)?;
    Ok(validated)
}

pub fn clear_wallpaper_in_dir(dir: &Path) -> Result<(), String> {
    let path = dir.join(WALLPAPER_FILE);
    match fs::symlink_metadata(&path) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Ok(_) => {
            crate::identities::private::safe(&path)?;
            fs::remove_file(&path).map_err(|_| "无法清除自定义壁纸。".to_string())
        }
        Err(_) => Err("无法清除自定义壁纸。".into()),
    }
}

pub fn apply_native_window_theme(app: &AppHandle, theme_mode: &str) {
    let native_theme = match theme_mode {
        "dark" => Some(Theme::Dark),
        "light" => Some(Theme::Light),
        _ => None,
    };
    for label in ["main", "monitor"] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.set_theme(native_theme);
        }
    }
}

impl UiAppearanceState {
    pub fn load(app: &AppHandle) -> Self {
        let (appearance, wallpaper) = app
            .path()
            .app_data_dir()
            .ok()
            .map(|dir| {
                (
                    read_appearance_from_path(&dir.join(APPEARANCE_FILE)),
                    read_wallpaper_from_path(&dir.join(WALLPAPER_FILE)),
                )
            })
            .unwrap_or((None, None));
        if let Some(ref prefs) = appearance {
            apply_native_window_theme(app, &prefs.theme);
        }
        Self {
            appearance: Mutex::new(appearance),
            wallpaper: Mutex::new(wallpaper),
        }
    }
}

#[tauri::command]
pub fn ui_appearance_read(app: AppHandle) -> Option<UiAppearanceDto> {
    app.state::<UiAppearanceState>()
        .appearance
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

#[tauri::command]
pub fn ui_appearance_write(app: AppHandle, prefs: UiAppearanceDto) -> Result<UiAppearanceDto, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "无法保存界面外观偏好。".to_string())?;
    let state = app.state::<UiAppearanceState>();
    let mut guard = state
        .appearance
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let saved = write_appearance_to_dir(&dir, &prefs)?;
    apply_native_window_theme(&app, &saved.theme);
    *guard = Some(saved.clone());
    Ok(saved)
}

#[tauri::command]
pub fn ui_wallpaper_read(app: AppHandle) -> Option<UiWallpaperDto> {
    app.state::<UiAppearanceState>()
        .wallpaper
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

#[tauri::command]
pub fn ui_wallpaper_write(app: AppHandle, wallpaper: UiWallpaperDto) -> Result<UiWallpaperDto, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "settings.wallpaperReadFailed".to_string())?;
    let state = app.state::<UiAppearanceState>();
    let mut guard = state
        .wallpaper
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let saved = write_wallpaper_to_dir(&dir, &wallpaper)?;
    *guard = Some(saved.clone());
    Ok(saved)
}

#[tauri::command]
pub fn ui_wallpaper_clear(app: AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "无法清除自定义壁纸。".to_string())?;
    let state = app.state::<UiAppearanceState>();
    let mut guard = state
        .wallpaper
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    clear_wallpaper_in_dir(&dir)?;
    *guard = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appearance_dto_sanitizes_invalid_enums_and_clamps_optical_glass_sliders() {
        let dirty = UiAppearanceDto {
            theme: "neon".into(),
            accent: "invalid".into(),
            reduce_motion: true,
            sidebar_layout: "floating".into(),
            surface_style: "metallic".into(),
            backdrop: "unknown".into(),
            glass_blur: 99,
            glass_opacity: 10,
            wallpaper_dim: 200,
            font_family: "comic".into(),
            mono_font: "courier".into(),
            quota_display: "none".into(),
            ui_scale: 150,
            startup_page: "secret".into(),
        };
        let clean = dirty.sanitized();
        assert_eq!(clean.theme, "light");
        assert_eq!(clean.accent, "terracotta");
        assert!(clean.reduce_motion);
        assert_eq!(clean.sidebar_layout, "classic");
        assert_eq!(clean.surface_style, "cockpit");
        assert_eq!(clean.backdrop, "minimal");
        assert_eq!(clean.glass_blur, 40);
        assert_eq!(clean.glass_opacity, 45);
        assert_eq!(clean.wallpaper_dim, 65);
        assert_eq!(clean.font_family, "system");
        assert_eq!(clean.mono_font, "cascadia");
        assert_eq!(clean.quota_display, "remaining");
        assert_eq!(clean.ui_scale, 100);
        assert_eq!(clean.startup_page, "remember");
    }

    #[test]
    fn wallpaper_validation_accepts_bounded_image_data_urls_and_rejects_paths_or_urls() {
        let valid = UiWallpaperDto {
            data_url: "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA".into(),
            suggested_accent: "amber".into(),
            width: 1920,
            height: 1080,
            updated_at: 1700000000000,
        };
        assert!(valid.validated().is_ok());

        for bad in [
            "",
            "file:///C:/Users/admin/wallpaper.png",
            "https://example.com/wallpaper.webp",
            "C:\\Users\\admin\\pic.jpg",
            "data:text/html;base64,PHNjcmlwdD4=",
            "data:image/png;base64,abc\ndef",
        ] {
            let dto = UiWallpaperDto {
                data_url: bad.into(),
                suggested_accent: "cockpit".into(),
                width: 800,
                height: 600,
                updated_at: 1,
            };
            assert!(dto.validated().is_err(), "expected {bad} to be rejected");
        }
    }

    #[test]
    fn private_atomic_persistence_roundtrips_appearance_and_wallpaper() {
        let root = std::env::temp_dir().join(format!(
            "claude-local-appearance-{}",
            crate::identities::new_id().unwrap()
        ));
        let prefs = UiAppearanceDto {
            theme: "dark".into(),
            accent: "violet".into(),
            reduce_motion: false,
            sidebar_layout: "compact".into(),
            surface_style: "glass".into(),
            backdrop: "dune".into(),
            glass_blur: 28,
            glass_opacity: 68,
            wallpaper_dim: 22,
            font_family: "humanist".into(),
            mono_font: "jetbrains".into(),
            quota_display: "used".into(),
            ui_scale: 105,
            startup_page: "cleaner".into(),
        };
        let saved_prefs = write_appearance_to_dir(&root, &prefs).unwrap();
        let loaded_prefs = read_appearance_from_path(&root.join(APPEARANCE_FILE)).unwrap();
        assert_eq!(saved_prefs, loaded_prefs);

        let wallpaper = UiWallpaperDto {
            data_url: "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA".into(),
            suggested_accent: "rose".into(),
            width: 1600,
            height: 900,
            updated_at: 1700000000123,
        };
        let saved_wp = write_wallpaper_to_dir(&root, &wallpaper).unwrap();
        let loaded_wp = read_wallpaper_from_path(&root.join(WALLPAPER_FILE)).unwrap();
        assert_eq!(saved_wp, loaded_wp);

        clear_wallpaper_in_dir(&root).unwrap();
        assert!(read_wallpaper_from_path(&root.join(WALLPAPER_FILE)).is_none());

        let _ = fs::remove_file(root.join(APPEARANCE_FILE));
        let _ = fs::remove_dir(&root);
    }
}
