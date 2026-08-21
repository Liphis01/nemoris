use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{
    Emitter, Manager, RunEvent, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::UpdaterExt;

const BACKEND_STATUS_EVENT: &str = "backend://status";

#[derive(Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
enum BackendPhase {
    Starting,
    Ready,
    Failed,
}

#[derive(Clone, serde::Serialize)]
struct BackendStatus {
    phase: BackendPhase,
}

// Holds both the Python process and its readiness state. Keeping the latest
// status in Rust makes the frontend subscription race-free: it listens for
// future changes, then reads this snapshot.
struct BackendRuntime {
    child: Mutex<Option<CommandChild>>,
    status: Mutex<BackendStatus>,
    // Set right before we kill our own backend on purpose (app quit, or an
    // update handing off to the platform installer). Lets the CommandEvent
    // reader tell "we did this" apart from "it crashed on its own".
    shutting_down: AtomicBool,
}

impl BackendRuntime {
    fn starting() -> Self {
        Self {
            child: Mutex::new(None),
            status: Mutex::new(BackendStatus {
                phase: BackendPhase::Starting,
            }),
            shutting_down: AtomicBool::new(false),
        }
    }
}

// Shared by the normal-quit RunEvent handler and the updater's on_before_exit
// hook: on Windows the updater calls std::process::exit() directly to hand
// off to the new installer, bypassing RunEvent entirely, so both paths must
// call this explicitly or the sidecar is left holding its own exe file open.
//
// Marking shutting_down first matters because killing the child races the
// process's own exit: the CommandEvent::Terminated this triggers can reach
// the reader loop while the window is still alive for a few more
// milliseconds. Without the flag that loop reports it as a crash, which
// flashes the startup gate's failure screen over a perfectly healthy update
// handoff — and clicking its retry button there relaunches the still-old
// process, short-circuiting the installer instead of letting it finish.
fn kill_backend(app: &tauri::AppHandle) {
    let runtime = app.state::<BackendRuntime>();
    runtime.shutting_down.store(true, Ordering::SeqCst);
    let child = runtime.child.lock().unwrap().take();
    if let Some(child) = child {
        let _ = child.kill();
    }
}

fn set_backend_phase(app: &tauri::AppHandle, phase: BackendPhase, expected: Option<BackendPhase>) {
    let status = {
        let runtime = app.state::<BackendRuntime>();
        let mut status = runtime.status.lock().unwrap();

        if expected.is_some_and(|expected| status.phase != expected) || status.phase == phase {
            return;
        }

        status.phase = phase;
        status.clone()
    };

    let _ = app.emit(BACKEND_STATUS_EVENT, status);
}

#[tauri::command]
fn backend_status(state: tauri::State<'_, BackendRuntime>) -> BackendStatus {
    state.status.lock().unwrap().clone()
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

fn wait_for_backend(port: u16) -> bool {
    for _ in 0..150 {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }

    false
}

fn set_window_resizable<R: Runtime>(window: &WebviewWindow<R>, resizable: bool) {
    match window.is_resizable() {
        Ok(current) if current == resizable => return,
        _ => {}
    }

    if let Err(error) = window.set_resizable(resizable) {
        log::warn!("could not update window resizable state: {error}");
    }
}

fn sync_window_resizable<R: Runtime>(window: &WebviewWindow<R>) {
    if window.is_minimized().unwrap_or(false) || !window.is_focused().unwrap_or(true) {
        set_window_resizable(window, true);
        return;
    }

    let Ok(maximized) = window.is_maximized() else {
        return;
    };

    set_window_resizable(window, !maximized);
}

#[cfg(target_os = "linux")]
fn configure_linux_webkit_graphics_workarounds() {
    // Keep the AppImage/WebKitGTK EGL fallback scoped to the DMABUF renderer.
    // Disabling compositing globally forces a slower paint path and makes the
    // whole UI lag on recent Arch/WebKitGTK stacks.
    const DMABUF_RENDERER_FLAG: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
    if std::env::var_os(DMABUF_RENDERER_FLAG).is_none() {
        std::env::set_var(DMABUF_RENDERER_FLAG, "1");
    }
}

#[cfg(not(target_os = "linux"))]
fn configure_linux_webkit_graphics_workarounds() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure_linux_webkit_graphics_workarounds();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            backend_status,
            check_for_update,
            install_update
        ])
        .manage(BackendRuntime::starting())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let port = pick_free_port();
            let backend_dir = app.path().resource_dir()?.join("backend");
            let backend_name = if cfg!(target_os = "windows") {
                "nemoris-backend.exe"
            } else {
                "nemoris-backend"
            };
            let backend_executable = backend_dir.join(backend_name);

            // The complete PyInstaller onedir lives in Tauri's resources. It
            // starts in place instead of extracting ~1,500 files to a temporary
            // directory on every launch.
            let backend_process = app
                .shell()
                .command(&backend_executable)
                .current_dir(&backend_dir)
                .env("QUIZ_APP_PORT", port.to_string())
                .env("NEMORIS_PARENT_PID", std::process::id().to_string())
                .spawn();

            match backend_process {
                Ok((mut rx, child)) => {
                    app.state::<BackendRuntime>()
                        .child
                        .lock()
                        .unwrap()
                        .replace(child);

                    // Drain the backend pipes (they would block if left unread),
                    // mirror output into the Tauri log and surface an unexpected
                    // exit to the startup gate.
                    let app_for_output = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        while let Some(event) = rx.recv().await {
                            match event {
                                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                                    log::info!("[backend] {}", String::from_utf8_lossy(&line));
                                }
                                CommandEvent::Terminated(payload) => {
                                    log::warn!("backend process terminated: {payload:?}");
                                    if !app_for_output
                                        .state::<BackendRuntime>()
                                        .shutting_down
                                        .load(Ordering::SeqCst)
                                    {
                                        set_backend_phase(&app_for_output, BackendPhase::Failed, None);
                                    }
                                }
                                CommandEvent::Error(error) => {
                                    log::error!("backend process error: {error}");
                                    if !app_for_output
                                        .state::<BackendRuntime>()
                                        .shutting_down
                                        .load(Ordering::SeqCst)
                                    {
                                        set_backend_phase(&app_for_output, BackendPhase::Failed, None);
                                    }
                                }
                                _ => {}
                            }
                        }
                    });

                    // Readiness probing must not block Tauri's setup callback:
                    // the window is built below while Python initializes.
                    let app_for_readiness = app.handle().clone();
                    std::thread::spawn(move || {
                        if wait_for_backend(port) {
                            set_backend_phase(
                                &app_for_readiness,
                                BackendPhase::Ready,
                                Some(BackendPhase::Starting),
                            );
                        } else {
                            log::warn!("backend did not answer on port {port} within timeout");
                            set_backend_phase(
                                &app_for_readiness,
                                BackendPhase::Failed,
                                Some(BackendPhase::Starting),
                            );
                        }
                    });
                }
                Err(error) => {
                    log::error!(
                        "failed to start backend at {}: {error}",
                        backend_executable.display()
                    );
                    set_backend_phase(app.handle(), BackendPhase::Failed, None);
                }
            }

            // Build the window immediately. The init script hands the backend
            // URL to the frontend before any scripts run; React keeps the real
            // app unmounted until backend_status reports readiness.
            let backend = format!("http://127.0.0.1:{port}");
            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("Nemoris")
                    .inner_size(1280.0, 850.0)
                    .min_inner_size(1024.0, 700.0)
                    .decorations(false)
                    .maximized(true)
                    .initialization_script(&format!("window.__NEMORIS_BACKEND__ = '{backend}';"))
                    .build()?;

            sync_window_resizable(&window);
            let window_for_resize_state = window.clone();
            window.on_window_event(move |event| match event {
                WindowEvent::Resized(_)
                | WindowEvent::Moved(_)
                | WindowEvent::ScaleFactorChanged { .. }
                | WindowEvent::Focused(_) => sync_window_resizable(&window_for_resize_state),
                _ => {}
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Tauri application")
        .run(|app, event| match event {
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::Destroyed,
                ..
            } if label == "main" => {
                kill_backend(app);
                app.exit(0);
            }
            RunEvent::ExitRequested { .. } | RunEvent::Exit => kill_backend(app),
            _ => {}
        });
}
