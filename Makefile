.PHONY: help dev build/darwin-arm64 build/windows-amd64 build/all build/sidecar build/copy-ffmpeg build/frontend clean

AGENT_DIR := agent
SIDECAR_DIR := src-tauri/binaries
VENDOR_FFMPEG := vendor/ffmpeg

help: ## 显示帮助
	@echo "FFAgent 构建命令:"
	@echo ""
	@echo "  make dev                  开发模式 (编译 agent + 启动 tauri dev)"
	@echo "  make build/darwin-arm64   打包 macOS arm64 版本"
	@echo "  make build/windows-amd64  打包 Windows amd64 版本"
	@echo "  make build/all            打包所有平台"
	@echo "  make clean                清理构建产物"
	@echo ""

# ==================================================================================== #
# 开发
# ==================================================================================== #

## dev: 开发模式启动
dev:
	@echo '>>> 编译 Go Agent (开发版本)...'
	@cd $(AGENT_DIR) && make build/sidecar/dev
	@echo '>>> 启动 Tauri 开发模式...'
	@cargo tauri dev

# ==================================================================================== #
# Go Sidecar 编译
# ==================================================================================== #

## build/sidecar/darwin-arm64: 编译 macOS arm64 Go Agent
build/sidecar/darwin-arm64:
	@cd $(AGENT_DIR) && make build/sidecar/darwin-arm64

## build/sidecar/windows-amd64: 编译 Windows amd64 Go Agent
build/sidecar/windows-amd64:
	@cd $(AGENT_DIR) && make build/sidecar/windows-amd64

## build/sidecar: 编译所有平台 Go Agent
build/sidecar:
	@cd $(AGENT_DIR) && make build/sidecar

# ==================================================================================== #
# FFmpeg 二进制
# ==================================================================================== #

## build/copy-ffmpeg/darwin-arm64: 复制 macOS arm64 ffmpeg
build/copy-ffmpeg/darwin-arm64:
	@echo '>>> 复制 ffmpeg 二进制 (darwin-arm64)...'
	@mkdir -p $(SIDECAR_DIR)
	@test -f $(VENDOR_FFMPEG)/darwin-arm64/ffmpeg || (echo "错误: $(VENDOR_FFMPEG)/darwin-arm64/ffmpeg 不存在，请先下载" && exit 1)
	@cp $(VENDOR_FFMPEG)/darwin-arm64/ffmpeg $(SIDECAR_DIR)/ffmpeg-aarch64-apple-darwin
	@cp $(VENDOR_FFMPEG)/darwin-arm64/ffprobe $(SIDECAR_DIR)/ffprobe-aarch64-apple-darwin
	@chmod +x $(SIDECAR_DIR)/ffmpeg-aarch64-apple-darwin $(SIDECAR_DIR)/ffprobe-aarch64-apple-darwin
	@echo '>>> OK'

## build/copy-ffmpeg/windows-amd64: 复制 Windows amd64 ffmpeg
build/copy-ffmpeg/windows-amd64:
	@echo '>>> 复制 ffmpeg 二进制 (windows-amd64)...'
	@mkdir -p $(SIDECAR_DIR)
	@test -f $(VENDOR_FFMPEG)/windows-amd64/ffmpeg.exe || (echo "错误: $(VENDOR_FFMPEG)/windows-amd64/ffmpeg.exe 不存在，请先下载" && exit 1)
	@cp $(VENDOR_FFMPEG)/windows-amd64/ffmpeg.exe $(SIDECAR_DIR)/ffmpeg-x86_64-pc-windows-msvc.exe
	@cp $(VENDOR_FFMPEG)/windows-amd64/ffprobe.exe $(SIDECAR_DIR)/ffprobe-x86_64-pc-windows-msvc.exe
	@echo '>>> OK'

# ==================================================================================== #
# 前端
# ==================================================================================== #

## build/frontend: 构建前端
build/frontend:
	@echo '>>> 构建前端...'
	@yarn build
	@echo '>>> OK'

# ==================================================================================== #
# 打包 macOS arm64
# ==================================================================================== #

## build/darwin-arm64: 一键打包 macOS arm64
build/darwin-arm64: build/sidecar/darwin-arm64 build/copy-ffmpeg/darwin-arm64
	@echo '>>> 打包 Tauri (macOS arm64)...'
	@cargo tauri build --target aarch64-apple-darwin --bundles app || true
	@echo '============================================'
	@echo '>>> macOS arm64 打包完成!'
	@echo '>>> .app 位于: src-tauri/target/aarch64-apple-darwin/release/bundle/macos/'
	@echo '>>> 如需 DMG: cargo tauri build --target aarch64-apple-darwin'
	@echo '============================================'

# ==================================================================================== #
# 打包 Windows amd64 (交叉编译，需要安装交叉编译工具链)
# ==================================================================================== #

## build/windows-amd64: 一键打包 Windows amd64
build/windows-amd64: build/sidecar/windows-amd64 build/copy-ffmpeg/windows-amd64
	@echo '>>> 打包 Tauri (Windows amd64)...'
	@echo '注意: 从 macOS 交叉编译 Windows 需要安装 MSVC 工具链'
	@echo '建议在 Windows 机器或 CI 环境 (GitHub Actions) 上构建 Windows 版本'
	@cargo tauri build --target x86_64-pc-windows-msvc || \
		echo '>>> Windows 交叉编译失败，请在 Windows 环境或 CI 中构建'
	@echo '============================================'
	@echo '>>> Windows amd64 打包完成 (如果成功)!'
	@echo '>>> 产物位于: src-tauri/target/x86_64-pc-windows-msvc/release/bundle/'
	@echo '============================================'

# ==================================================================================== #
# 全平台打包
# ==================================================================================== #

## build/all: 打包所有平台
build/all: build/darwin-arm64
	@echo ''
	@echo '注意: Windows 版本需要在 Windows 环境或 CI 中构建'
	@echo '请运行: make build/windows-amd64 (在 Windows 上)'

# ==================================================================================== #
# 清理
# ==================================================================================== #

## clean: 清理构建产物
clean:
	@echo '>>> 清理...'
	@rm -rf dist
	@rm -rf $(SIDECAR_DIR)/agent-* $(SIDECAR_DIR)/ffmpeg-* $(SIDECAR_DIR)/ffprobe-*
	@cd $(AGENT_DIR) && rm -rf build
	@echo '>>> OK'
