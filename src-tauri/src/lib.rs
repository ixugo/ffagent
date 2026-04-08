use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

/// 持有 sidecar 子进程句柄，退出时自动 kill
struct SidecarGuard(std::sync::Mutex<Option<CommandChild>>);

impl Drop for SidecarGuard {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
}

/// 存储 Go Agent 实际监听端口，供前端通过 invoke 查询
struct AgentPort(AtomicU16);

/// 前端通过 invoke("get_agent_port") 获取 Go Agent 端口
#[tauri::command]
fn get_agent_port(state: tauri::State<'_, AgentPort>) -> u16 {
    state.0.load(Ordering::SeqCst)
}

/// 前端通过 invoke("open_settings") 触发设置页切换
#[tauri::command]
fn open_settings(app: AppHandle) {
    let _ = app.emit("toggle-settings", ());
}

/// 查找 ffmpeg/ffprobe 所在的 binaries 目录（开发模式与打包模式路径不同）
fn resolve_bin_dir(app: &AppHandle) -> std::path::PathBuf {
    if let Ok(res) = app.path().resource_dir() {
        let prod = res.join("binaries");
        if prod.exists() {
            return prod;
        }
    }
    let dev = std::env::current_dir()
        .unwrap_or_default()
        .join("binaries");
    if dev.exists() {
        return dev;
    }
    std::env::current_dir()
        .unwrap_or_default()
        .parent()
        .map(|p| p.join("src-tauri").join("binaries"))
        .unwrap_or_default()
}

/// 启动 Go Agent sidecar，解析 stdout 中的 PORT= 行以获取端口
fn start_agent_sidecar(app: &AppHandle, port_state: Arc<AtomicU16>) {
    let bin_dir = resolve_bin_dir(app);

    // 使用 app_data_dir 存储配置和数据库，因 resource_dir 在签名后不可写
    let data_dir = app
        .path()
        .app_data_dir()
        .expect("无法获取 app data dir");
    let config_dir = data_dir.join("configs");
    let _ = std::fs::create_dir_all(&config_dir);

    let cache_parent = app
        .path()
        .cache_dir()
        .expect("无法获取 cache dir");
    let ffagent_cache = cache_parent.join("ffagent");
    let _ = std::fs::create_dir_all(&ffagent_cache);

    let config_str = config_dir.to_string_lossy().to_string();
    let bin_str = bin_dir.to_string_lossy().to_string();
    let cache_str = ffagent_cache.to_string_lossy().to_string();

    log::info!(
        "启动 Go Agent sidecar: config={}, bin={}, cache={}",
        config_str, bin_str, cache_str
    );

    // tauri_build 会将 externalBin 中的 "binaries/agent-{triple}" 复制到
    // target/{profile}/agent（去掉目录前缀和 triple），所以 sidecar 名称只用 "agent"
    let sidecar = match app.shell().sidecar("agent") {
        Ok(cmd) => cmd
            .args(["-conf", &config_str, "-ffmpeg-dir", &bin_str])
            .env("FFAGENT_CACHE_DIR", &cache_str),
        Err(e) => {
            log::error!(
                "无法创建 agent sidecar 命令: {:?}，将使用默认端口 15123",
                e
            );
            return;
        }
    };

    match sidecar.spawn() {
        Ok((mut rx, child)) => {
            app.manage(SidecarGuard(std::sync::Mutex::new(Some(child))));

            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let text = String::from_utf8_lossy(&line);
                            let trimmed = text.trim();
                            if trimmed.is_empty() {
                                continue;
                            }
                            log::debug!("[agent] {}", trimmed);
                            if let Some(port_str) = trimmed.strip_prefix("PORT=") {
                                if let Ok(p) = port_str.parse::<u16>() {
                                    port_state.store(p, Ordering::SeqCst);
                                    log::info!("Agent 端口已解析: {}", p);
                                }
                            }
                        }
                        CommandEvent::Stderr(line) => {
                            let text = String::from_utf8_lossy(&line);
                            log::error!("[agent:err] {}", text.trim());
                        }
                        CommandEvent::Terminated(status) => {
                            log::warn!("Agent 进程已退出: {:?}", status);
                            break;
                        }
                        _ => {}
                    }
                }
            });
        }
        Err(e) => {
            log::error!(
                "启动 agent sidecar 失败: {:?}，将使用默认端口 15123",
                e
            );
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let port = Arc::new(AtomicU16::new(15123));

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 已有实例运行时，激活并聚焦主窗口
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .manage(AgentPort(AtomicU16::new(15123)))
        .invoke_handler(tauri::generate_handler![get_agent_port, open_settings])
        .setup(move |app| {
            let handle = app.handle().clone();
            let port_clone = Arc::clone(&port);

            start_agent_sidecar(&handle, Arc::clone(&port));

            // 延迟同步端口到 managed state，给 Agent 一点启动时间
            let port_sync = Arc::clone(&port_clone);
            let handle_sync = handle.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                let p = port_sync.load(Ordering::SeqCst);
                handle_sync.state::<AgentPort>().0.store(p, Ordering::SeqCst);
                log::info!("Agent 端口已同步到 state: {}", p);
            });

            // macOS 菜单
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{MenuBuilder, SubmenuBuilder, MenuItemBuilder};

                let settings_item = MenuItemBuilder::new("Settings")
                    .accelerator("CmdOrCtrl+,")
                    .id("settings")
                    .build(app)?;

                let app_submenu = SubmenuBuilder::new(app, "FFAgent")
                    .about(None)
                    .separator()
                    .item(&settings_item)
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator()
                    .quit()
                    .build()?;

                let edit_submenu = SubmenuBuilder::new(app, "Edit")
                    .undo()
                    .redo()
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .build()?;

                let window_submenu = SubmenuBuilder::new(app, "Window")
                    .minimize()
                    .close_window()
                    .build()?;

                let menu = MenuBuilder::new(app)
                    .item(&app_submenu)
                    .item(&edit_submenu)
                    .item(&window_submenu)
                    .build()?;

                app.set_menu(menu)?;

                let handle_for_menu = handle.clone();
                app.on_menu_event(move |_app, event| {
                    if event.id().as_ref() == "settings" {
                        let _ = handle_for_menu.emit("toggle-settings", ());
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
