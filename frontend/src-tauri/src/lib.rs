use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::UpdaterExt;

// Holds the Python backend child so it can be killed when the app exits.
struct BackendChild(Mutex<Option<CommandChild>>);

// Shared by the normal-quit RunEvent handler and the updater's on_before_exit
// hook: on Windows the updater calls std::process::exit() directly to hand
// off to the new installer, bypassing RunEvent entirely, so both paths must
// call this explicitly or the sidecar is left holding its own exe file open.
fn kill_backend(app: &tauri::AppHandle) {
    if let Some(child) = app.state::<BackendChild>().0.lock().unwrap().take() {
        let _ = child.kill();
    }
}

#[derive(serde::Serialize)]
struct UpdateInfo {
    version: String,
    notes: Option<String>,
}

#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = app.updater_builder().build().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;

    Ok(update.map(|u| UpdateInfo {
        version: u.version.clone(),
        notes: u.body.clone(),
    }))
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let app_for_hook = app.clone();
    let updater = app
        .updater_builder()
        .on_before_exit(move || kill_backend(&app_for_hook))
        .build()
        .map_err(|e| e.to_string())?;

    if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
        update
            .download_and_install(
                |chunk_len, total| {
                    let _ = app.emit("update://progress", (chunk_len, total));
                },
                || {},
            )
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

// Ask the OS for a free port by binding to :0, then release it for the
// sidecar to claim. A tiny race exists between release and rebind, but it is
// negligible on a local machine and far simpler than coordinating a handoff.
fn pick_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("could not find a free port")
        .local_addr()
        .expect("could not read local addr")
        .port()
}

fn wait_for_backend(port: u16) {
    for _ in 0..150 {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    log::warn!("backend did not answer on port {port} within timeout");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![check_for_update, install_update])
        .manage(BackendChild(Mutex::new(None)))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let port = pick_free_port();

            // Launch the packaged FastAPI backend; it reads QUIZ_APP_PORT.
            let (mut rx, child) = app
                .shell()
                .sidecar("nemoris-backend")
                .expect("nemoris-backend sidecar is missing from the bundle")
                .env("QUIZ_APP_PORT", port.to_string())
                .spawn()
                .expect("failed to spawn the backend sidecar");

            app.state::<BackendChild>()
                .0
                .lock()
                .unwrap()
                .replace(child);

            // Drain the sidecar's pipes (they would block if left unread) and
            // mirror its output into the Tauri log.
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                            log::info!("[backend] {}", String::from_utf8_lossy(&line));
                        }
                        _ => {}
                    }
                }
            });

            wait_for_backend(port);

            // Frameless + maximized window. The init script hands the backend
            // URL to the frontend before any of its scripts run, so the API
            // layer targets the sidecar (a separate origin under Tauri).
            let backend = format!("http://127.0.0.1:{port}");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Nemoris")
                .inner_size(1280.0, 850.0)
                .min_inner_size(1024.0, 700.0)
                .decorations(false)
                .maximized(true)
                .initialization_script(&format!(
                    "window.__NEMORIS_BACKEND__ = '{backend}';"
                ))
                .build()?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Tauri application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                kill_backend(app);
            }
        });
}
