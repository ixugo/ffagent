# FFAgent -- AI 驱动的音视频处理桌面应用

FFAgent 是一个 AI 智能体桌面应用，通过自然语言对话完成 FFmpeg 音视频处理操作。拖入文件、描述需求，AI 自动生成并执行 FFmpeg 命令，遇到问题自主重试纠错。

## 技术栈

| 层级 | 技术 | 职责 |
|------|------|------|
| **UI** | React 19 + Ant Design X | 聊天界面、设置页面、国际化 |
| **壳** | Tauri v2 | 桌面应用框架，管理 Go 子进程 |
| **Agent** | Go + go-openai SDK | AI 通信、FFmpeg 命令执行、多轮纠错 |
| **存储** | SQLite | 会话、消息、配置持久化 |

## 功能特性

- 拖拽文件到聊天窗口或点击选择附件
- 自然语言描述任务，AI 自动生成 FFmpeg 命令
- 基于 OpenAI Function Calling 的结构化工具调用
- 最多 7 轮自动重试纠错，AI 自主分析错误并修正
- 对话式交互体验，执行过程中提供进度反馈
- 输出文件可点击打开所在目录
- 中文/英文 UI 切换，AI 回复语言跟随用户
- 支持自定义 OpenAI 兼容 API（LM Studio、Ollama 等）

## 项目结构

```
ffagent/
├── src/                   # React 前端
│   ├── components/        # UI 组件
│   ├── pages/             # 页面
│   ├── services/          # API/SSE/i18n 服务
│   └── locales/           # 语言包
├── src-tauri/             # Tauri Rust 壳
│   └── src/lib.rs         # Go 子进程管理 + 菜单
├── agent/                 # Go Agent 后端
│   ├── internal/ai/       # OpenAI SDK 封装
│   ├── internal/pkg/ffmpeg/ # FFmpeg 执行器
│   ├── internal/core/     # 业务领域 (goddd 六边形架构)
│   └── internal/web/api/  # HTTP/SSE 路由
└── vendor/ffmpeg/         # 预编译 ffmpeg/ffprobe 二进制
```

## 开发

### 前置要求

- Node.js 18+、Yarn
- Go 1.23+
- Rust (Tauri v2)
- ffmpeg 8.0 (开发时可使用系统安装版本)

### 启动开发

```bash
# 1. 安装前端依赖
yarn install

# 2. 编译 Go Agent（开发版本）
cd agent && make build/sidecar/dev && cd ..

# 3. 启动 Tauri 开发模式
cargo tauri dev
```

### 单独启动 Go Agent

```bash
cd agent
go run . -conf ./configs
```

### 排查内嵌 Agent 与健康检查

- 默认 HTTP 监听 **`127.0.0.1:15123`**（仅 IPv4 环回）。在 macOS 上若 `curl http://localhost:15123/health` 失败，多半是 `localhost` 被解析到 **`::1`（IPv6）**，请改用：

  ```bash
  curl http://127.0.0.1:15123/health
  ```

- 桌面模式下日志与 SQLite 位于应用数据目录，例如 macOS：`~/Library/Application Support/com.ffagent.app/configs/`（含 `logs/`、`data.db`）。

- 需要更详细的 FFmpeg 调用参数与输出校验日志时，将上述目录内 `config.toml` 中 `[Log]` 的 `Level` 改为 `debug` 后重启应用。

## 构建打包

```bash
# 编译所有平台 sidecar + 复制 ffmpeg + 打包
cd agent && make build/app
```

### 手动分步构建

```bash
# 1. 编译 Go sidecar（macOS arm64 + Windows amd64）
cd agent && make build/sidecar

# 2. 复制 ffmpeg 二进制
make build/copy-ffmpeg

# 3. 构建前端
cd .. && yarn build

# 4. 打包 Tauri
cd src-tauri && cargo tauri build
```

## FFmpeg 二进制

从 <https://github.com/btbn/ffmpeg-builds/releases> 下载对应平台的 ffmpeg/ffprobe：

- macOS arm64: 放入 `vendor/ffmpeg/darwin-arm64/`
- Windows amd64: 放入 `vendor/ffmpeg/windows-amd64/`

## 配置

设置页面（菜单 > Settings 或 `Cmd+,`）支持：

- API 地址（默认 `http://127.0.0.1:1234/v1`，兼容 LM Studio）
- API Key
- 模型名称
- 界面语言（中文/English）

## License

MIT
