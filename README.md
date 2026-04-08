<p align="center">
  <img src="logo.png" width="128" alt="FFAgent Logo" />
</p>

<h1 align="center">FFAgent</h1>

<p align="center">
  AI 驱动的音视频处理桌面应用。对话即操作，拖入文件、描述需求，剩下的交给 AI。
</p>

<p align="center">
  <a href="https://github.com/ixugo/ffagent/releases">下载</a> · <a href="#快速上手">快速上手</a> · <a href="#功能">功能</a>
</p>

---

FFAgent 将 FFmpeg 的强大能力封装在一个聊天界面背后。你不需要记住任何 FFmpeg 参数和命令，只需用自然语言告诉它你想做什么——转码、裁剪、提取音频、调整分辨率、合并视频，它会自动生成并执行正确的命令。如果执行出错，AI 会自主分析原因并重试，最多 7 轮自动纠错，直到任务完成。

## 功能

- **拖拽即用** — 将文件直接拖入聊天窗口，或点击附件按钮选择文件
- **自然语言驱动** — 用中文或英文描述你的需求，无需了解 FFmpeg 语法
- **自动纠错** — AI 分析执行错误并自动修正命令，最多 7 轮重试
- **实时反馈** — 执行过程中展示命令和输出，可折叠查看细节
- **一键打开** — 处理完成后直接点击打开输出文件所在目录
- **多语言** — 中文/英文界面切换，AI 回复语言跟随用户设置
- **兼容多种 AI 服务** — 支持 OpenAI、LM Studio、Ollama 等兼容 API

## 快速上手

1. 从 [Releases](https://github.com/ixugo/ffagent/releases) 下载对应平台的安装包
2. 安装并打开 FFAgent
3. 在设置页面（菜单栏 > Settings 或 `Cmd+,`）配置 AI 服务地址和 API Key
4. 拖入一个视频文件，输入你的需求，按回车

## 支持平台

- macOS (Apple Silicon)
- Windows (x64)
- Linux (x64 / arm64)

## 配置

在设置页面中可以配置：

- **API 地址** — 默认 `http://127.0.0.1:1234/v1`，兼容 LM Studio 本地运行
- **API Key** — 你的 AI 服务密钥
- **模型名称** — 使用的模型标识符
- **界面语言** — 中文 / English

## 开发

### 前置要求

- Node.js 22+
- Go 1.24+
- Rust (stable)
- macOS: Xcode Command Line Tools
- Linux: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`

### 启动开发模式

```bash
npm install
make dev
```

### 构建打包

```bash
make build/darwin-arm64    # macOS arm64
make build/windows-amd64   # Windows x64
make build/linux-amd64     # Linux x64
```

## FFmpeg 二进制

从 [FFmpeg Builds](https://github.com/btbn/ffmpeg-builds/releases) 下载对应平台的 ffmpeg/ffprobe 放入 `vendor/ffmpeg/` 对应子目录。

## License

MIT
