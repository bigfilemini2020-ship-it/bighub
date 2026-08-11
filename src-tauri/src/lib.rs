use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::PathBuf, sync::Mutex};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    plugin::PermissionState,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State, UserAttentionType, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSettings {
    minimize_to_tray: bool,
    autostart: bool,
    notifications_enabled: bool,
    notify_posts: bool,
    notify_comments: bool,
    notify_missions: bool,
    download_dir: Option<String>,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            minimize_to_tray: true,
            autostart: false,
            notifications_enabled: true,
            notify_posts: true,
            notify_comments: true,
            notify_missions: true,
            download_dir: None,
        }
    }
}

struct SettingsState(Mutex<DesktopSettings>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopUpdateInfo {
    available: bool,
    current_version: String,
    version: Option<String>,
    notes: Option<String>,
    date: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DriveDownloadOutput {
    path: String,
}


#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveDownloadedFileInput {
    name: String,
    data: Vec<u8>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientLogInput {
    line: String,
}



fn sanitize_file_name(name: &str) -> String {
    let cleaned = name
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();
    if cleaned.is_empty() { "download".to_string() } else { cleaned }
}

fn unique_download_path(dir: PathBuf, file_name: &str) -> PathBuf {
    let safe = sanitize_file_name(file_name);
    let candidate = dir.join(&safe);
    if !candidate.exists() {
        return candidate;
    }
    let path = std::path::Path::new(&safe);
    let stem = path.file_stem().and_then(|value| value.to_str()).unwrap_or("download");
    let ext = path.extension().and_then(|value| value.to_str()).unwrap_or("");
    for index in 1..1000 {
        let name = if ext.is_empty() {
            format!("{stem} ({index})")
        } else {
            format!("{stem} ({index}).{ext}")
        };
        let candidate = dir.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(safe)
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("desktop-settings.json"))
}

fn load_settings(app: &AppHandle) -> DesktopSettings {
    settings_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_settings(app: &AppHandle, settings: &DesktopSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let text = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(path, text).map_err(|error| error.to_string())
}

fn configured_download_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let settings = load_settings(app);
    if let Some(dir) = settings.download_dir.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        let path = PathBuf::from(dir);
        fs::create_dir_all(&path).map_err(|error| format!("다운로드 폴더를 사용할 수 없습니다. {error}"))?;
        return Ok(path);
    }
    app.path().download_dir().map_err(|error| error.to_string())
}
fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItemBuilder::with_id("open", "BigHub \u{C5F4}\u{AE30}").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "\u{C124}\u{C815} \u{C5F4}\u{AE30}").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "\u{C644}\u{C804} \u{C885}\u{B8CC}").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&open, &settings, &quit]).build()?;

    TrayIconBuilder::with_id("main-tray")
        .tooltip("BigHub")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "settings" => {
                show_main(app);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.eval("window.BigHubDesktopOpenSettings && window.BigHubDesktopOpenSettings()");
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[tauri::command]
fn get_desktop_app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
fn get_desktop_settings(app: AppHandle, state: State<SettingsState>) -> Result<DesktopSettings, String> {
    let mut settings = state
        .0
        .lock()
        .map_err(|_| "?ㅼ젙???쎌? 紐삵뻽?듬땲??".to_string())?
        .clone();
    if let Ok(enabled) = app.autolaunch().is_enabled() {
        settings.autostart = enabled;
    }
    Ok(settings)
}

#[tauri::command]
fn set_desktop_setting(
    app: AppHandle,
    state: State<SettingsState>,
    key: String,
    value: bool,
) -> Result<DesktopSettings, String> {
    let mut settings = state
        .0
        .lock()
        .map_err(|_| "?ㅼ젙????ν븯吏 紐삵뻽?듬땲??".to_string())?;

    match key.as_str() {
        "minimizeToTray" => settings.minimize_to_tray = value,
        "autostart" => {
            settings.autostart = value;
            if value {
                app.autolaunch().enable().map_err(|error| error.to_string())?;
            } else {
                app.autolaunch().disable().map_err(|error| error.to_string())?;
            }
        }
        "notificationsEnabled" => settings.notifications_enabled = value,
        "notifyPosts" => settings.notify_posts = value,
        "notifyComments" => settings.notify_comments = value,
        "notifyMissions" => settings.notify_missions = value,
        _ => return Err("?????녿뒗 ?ㅼ젙?낅땲??".to_string()),
    }

    save_settings(&app, &settings)?;
    Ok(settings.clone())
}

#[tauri::command]
fn choose_download_dir(app: AppHandle, state: State<SettingsState>) -> Result<DesktopSettings, String> {
    let Some(folder) = app.dialog().file().blocking_pick_folder() else {
        return get_desktop_settings(app, state);
    };
    let path = folder.into_path().map_err(|error| error.to_string())?;
    let mut settings = state
        .0
        .lock()
        .map_err(|_| "설정을 저장하지 못했습니다.".to_string())?;
    settings.download_dir = Some(path.to_string_lossy().to_string());
    save_settings(&app, &settings)?;
    Ok(settings.clone())
}
#[tauri::command]
async fn check_desktop_update(app: AppHandle) -> Result<DesktopUpdateInfo, String> {
    let updater = app.updater().map_err(|error| error.to_string())?;
    let current_version = app.package_info().version.to_string();
    let update = updater.check().await.map_err(|error| error.to_string())?;

    Ok(match update {
        Some(update) => DesktopUpdateInfo {
            available: true,
            current_version: update.current_version,
            version: Some(update.version),
            notes: update.body,
            date: update.date.map(|date| date.to_string()),
        },
        None => DesktopUpdateInfo {
            available: false,
            current_version,
            version: None,
            notes: None,
            date: None,
        },
    })
}

#[tauri::command]
async fn install_desktop_update(app: AppHandle) -> Result<(), String> {
    let Some(update) = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?
    else {
        return Err("?ㅼ튂???낅뜲?댄듃媛 ?놁뒿?덈떎.".to_string());
    };

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;
    app.restart()
}

fn request_taskbar_attention(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(true);
        if visible {
            let _ = window.request_user_attention(Some(UserAttentionType::Informational));
        }
    }
}
#[tauri::command]
fn notify_desktop(app: AppHandle, title: String, body: String) -> Result<(), String> {
    let permission = app
        .notification()
        .request_permission()
        .map_err(|error| error.to_string())?;
    if permission != PermissionState::Granted {
        return Err("Windows notification permission is not granted.".to_string());
    }
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())?;
    request_taskbar_attention(&app);
    Ok(())
}

#[tauri::command]
async fn save_downloaded_file(app: AppHandle, input: SaveDownloadedFileInput) -> Result<DriveDownloadOutput, String> {
    let download_dir = configured_download_dir(&app)?;
    let path = unique_download_path(download_dir, &input.name);
    fs::write(&path, input.data).map_err(|error| format!("파일 저장에 실패했습니다. {error}"))?;
    Ok(DriveDownloadOutput { path: path.to_string_lossy().to_string() })
}

#[tauri::command]
fn write_client_log(app: AppHandle, input: ClientLogInput) -> Result<String, String> {
    let dir = app.path().app_config_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join("bighub-client.log");
    let mut line = input.line.replace(['\r', '\n'], " ");
    if line.len() > 4000 {
        line.truncate(4000);
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| error.to_string())?;
    writeln!(file, "{line}").map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .setup(|app| {
            let settings = load_settings(&app.handle());
            app.manage(SettingsState(Mutex::new(settings)));
            create_tray(&app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if load_settings(window.app_handle()).minimize_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_desktop_app_version,
            get_desktop_settings,
            set_desktop_setting,
            choose_download_dir,
            notify_desktop,
            check_desktop_update,
            install_desktop_update,
            save_downloaded_file,
            write_client_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running BigHub");
}
