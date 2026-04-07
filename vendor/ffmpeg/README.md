# FFmpeg 二进制

本地开发时需手动下载对应平台的 ffmpeg/ffprobe 静态编译二进制：

- macOS arm64: <https://www.osxexperts.net/>（ffmpeg80arm.zip / ffprobe80arm.zip）
- Windows amd64: <https://www.gyan.dev/ffmpeg/builds/>（essentials 版本）
- Linux amd64: <https://github.com/BtbN/FFmpeg-Builds/releases>（linux64-gpl 版本）
- Linux arm64: <https://github.com/BtbN/FFmpeg-Builds/releases>（linuxarm64-gpl 版本）

放置位置：

```
darwin-arm64/
  ffmpeg
  ffprobe
windows-amd64/
  ffmpeg.exe
  ffprobe.exe
linux-amd64/
  ffmpeg
  ffprobe
linux-arm64/
  ffmpeg
  ffprobe
```

执行 `make build/copy-ffmpeg/<platform>` 将二进制复制到 `resources/binaries/`。

> **注意**: CI 构建时会自动下载 FFmpeg，无需提交二进制到仓库。
> macOS 版本务必使用静态编译版（仅依赖系统库），不要使用 Homebrew 的动态链接版。
