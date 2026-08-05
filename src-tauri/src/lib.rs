use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_notification::NotificationExt;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSettings {
    minimize_to_tray: bool,
    autostart: bool,
    notifications_enabled: bool,
    notify_posts: bool,
    notify_comments: bool,
    notify_missions: bool,
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
        }
    }
}

struct SettingsState(Mutex<DesktopSettings>);

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

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItemBuilder::with_id("open", "BigHub 열기").build(app)?;
    let settings = MenuItemBuilder::with_id("settings", "설정 열기").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "완전 종료").build(app)?;
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
fn get_desktop_settings(app: AppHandle, state: State<SettingsState>) -> Result<DesktopSettings, String> {
    let mut settings = state
        .0
        .lock()
        .map_err(|_| "설정을 읽지 못했습니다.".to_string())?
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
        .map_err(|_| "설정을 저장하지 못했습니다.".to_string())?;

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
        _ => return Err("알 수 없는 설정입니다.".to_string()),
    }

    save_settings(&app, &settings)?;
    Ok(settings.clone())
}

#[tauri::command]
fn notify_desktop(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
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
            get_desktop_settings,
            set_desktop_setting,
            notify_desktop
        ])
        .run(tauri::generate_context!())
        .expect("error while running BigHub");
}
