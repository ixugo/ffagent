use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    Manager, WebviewUrl, WebviewWindowBuilder,
};

struct AgentProcess(Mutex<Option<Child>>);

impl Drop for AgentProcess {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(ref mut child) = *guard {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

/// 供前端通过 invoke 读取端口，避免 setup 阶段主窗口尚未创建导致 eval 注入失败
#[derive(Clone)]
struct AgentPort(Arc<AtomicU16>);

impl AgentPort {
    fn new(port: u16) -> Self {
        Self(Arc::new(AtomicU16::new(port)))
    }
}

#[tauri::command]
fn get_agent_port(state: tauri::State<AgentPort>) -> u16 {
    state.0.load(Ordering::SeqCst)
}

#[tauri::command]
fn open_settings(app: tauri::AppHandle) {
    open_settings_window(&app);
}

/// 启动 Go Agent sidecar，返回实际监听端口；后台排空子进程 stdout，避免管道写满阻塞 Agent
fn start_agent(app: &tauri::App) -> Result<u16, Box<dyn std::error::Error>> {
    let resource_dir = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap());

    let bin_dir = resource_dir.join("binaries");

    // 查找 agent 二进制（Tauri externalBin 会追加 target triple 后缀）
    let target = if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
        "agent-aarch64-apple-darwin"
    } else if cfg!(target_os = "windows") && cfg!(target_arch = "x86_64") {
        "agent-x86_64-pc-windows-msvc.exe"
    } else {
        "agent"
    };

    let agent_bin = bin_dir.join(target);

    // 开发模式回退：查找编译产物
    let agent_bin = if agent_bin.exists() {
        agent_bin
    } else {
        let dev_fallbacks = vec![
            bin_dir.join("agent"),
            std::env::current_dir().unwrap().join("binaries").join("agent"),
        ];
        dev_fallbacks
            .into_iter()
            .find(|p| p.exists())
            .unwrap_or(agent_bin)
    };

    if !agent_bin.exists() {
        eprintln!("[tauri] agent binary not found: {:?}", agent_bin);
        return Ok(15123);
    }

    // 使用应用数据目录存储数据库和日志，避免 resource_dir 不可写
    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| resource_dir.join("data"));
    let config_dir = data_dir.join("configs");
    let _ = std::fs::create_dir_all(&config_dir);
    eprintln!("[tauri] agent config dir: {:?}", config_dir);

    // 处理缓存：系统/应用用户缓存目录下的 ffagent（如 macOS Library/Caches/.../ffagent）
    let cache_parent = app
        .path()
        .cache_dir()
        .unwrap_or_else(|_| data_dir.join("cache"));
    let ffagent_cache = cache_parent.join("ffagent");
    let _ = std::fs::create_dir_all(&ffagent_cache);
    eprintln!("[tauri] agent cache dir: {:?}", ffagent_cache);

    let mut child = Command::new(&agent_bin)
        .env("FFAGENT_CACHE_DIR", ffagent_cache.as_os_str())
        .arg("-conf")
        .arg(config_dir.to_str().unwrap_or("./configs"))
        .arg("-ffmpeg-dir")
        .arg(bin_dir.to_str().unwrap_or(""))
        .current_dir(&config_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()?;

    // 从 stdout 读取 "PORT=xxxxx" 获取实际端口
    let stdout = child.stdout.take().expect("failed to capture agent stdout");
    let mut reader = BufReader::new(stdout);

    let mut port: u16 = 15123;
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        let trimmed = line.trim_end();
        eprintln!("[agent] {}", trimmed);
        if let Some(p) = trimmed.strip_prefix("PORT=") {
            if let Ok(parsed) = p.trim().parse::<u16>() {
                port = parsed;
            }
            break;
        }
    }

    // 持续消费剩余 stdout，防止 Go 侧 fmt.Printf 等写满管道导致子进程阻塞
    std::thread::spawn(move || {
        let mut r = reader;
        let mut buf = [0u8; 8192];
        loop {
            match r.read(&mut buf) {
                Ok(0) => break,
                Ok(_) => {}
                Err(_) => break,
            }
        }
    });

    eprintln!("[tauri] agent started on port {}", port);
    app.manage(AgentProcess(Mutex::new(Some(child))));

    Ok(port)
}

fn build_menu(app: &tauri::App) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let app_menu = Submenu::with_items(
        app,
        "FFAgent",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About FFAgent"), None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "settings", "Settings\tCmd+,", true, Some("CmdOrCtrl+,"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &edit_menu, &window_menu])
}

fn open_settings_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.set_focus();
        return;
    }

    let _ = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("index.html#/settings".into()))
        .title("Settings")
        .inner_size(520.0, 680.0)
        .min_inner_size(480.0, 500.0)
        .resizable(true)
        .center()
        .build();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![get_agent_port, open_settings])
        .setup(|app| {
            let menu = build_menu(app)?;
            app.set_menu(menu)?;

            let port = start_agent(app).unwrap_or(15123);
            app.manage(AgentPort::new(port));

            // 尽力注入主窗口（若 setup 时尚未创建则前端通过 get_agent_port 兜底）
            if let Some(main_window) = app.get_webview_window("main") {
                let js = format!("window.__AGENT_PORT__ = {};", port);
                let _ = main_window.eval(&js);
            }

            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "settings" {
                open_settings_window(app);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
