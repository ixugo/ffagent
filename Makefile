.PHONY: help dev build/darwin-arm64 build/windows-amd64 build/all build/sidecar build/copy-ffmpeg build/frontend clean

AGENT_DIR := agent
SIDECAR_DIR := resources/binaries
VENDOR_FFMPEG := vendor/ffmpeg

help: ## 显示帮助
	@echo "FFAgent 构建命令:"
	@echo ""
	@echo "  make dev                  开发模式 (编译 agent + 启动 Electron dev)"
	@echo "  make build/darwin-arm64   打包 macOS arm64 版本"
	@echo "  make build/windows-amd64  打包 Windows amd64 版本 (macOS 上需 Wine)"
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
	@echo '>>> 启动 Electron 开发模式...'
	@npx vite

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

## build/frontend: 构建前端 + Electron 主进程
build/frontend:
	@echo '>>> 构建前端...'
	@npx vite build
	@echo '>>> OK'

# ==================================================================================== #
# 打包 macOS arm64
# ==================================================================================== #

## build/darwin-arm64: 一键打包 macOS arm64
build/darwin-arm64: build/sidecar/darwin-arm64 build/copy-ffmpeg/darwin-arm64 build/frontend
	@echo '>>> 打包 Electron (macOS arm64)...'
	@npx electron-builder --mac --arm64
	@echo '============================================'
	@echo '>>> macOS arm64 打包完成!'
	@echo '>>> 产物位于: release/'
	@echo '============================================'

# ==================================================================================== #
# 打包 Windows amd64 (在 macOS 上通过 Wine 交叉编译)
# ==================================================================================== #

## build/windows-amd64: 一键打包 Windows amd64
build/windows-amd64: build/sidecar/windows-amd64 build/copy-ffmpeg/windows-amd64 build/frontend
	@echo '>>> 打包 Electron (Windows amd64)...'
	@echo '>>> 注意: macOS 上打 Windows 包需要 Wine，electron-builder 会自动下载'
	@npx electron-builder --win --x64
	@echo '============================================'
	@echo '>>> Windows amd64 打包完成!'
	@echo '>>> 产物位于: release/'
	@echo '============================================'

# ==================================================================================== #
# 全平台打包 (macOS 上可同时构建 macOS + Windows)
# ==================================================================================== #

## build/all: 打包所有平台 (macOS 上通过 Wine 交叉编译 Windows)
build/all: build/sidecar build/frontend
	@echo '>>> 复制 FFmpeg (darwin-arm64)...'
	@mkdir -p $(SIDECAR_DIR)
	@if [ -f $(VENDOR_FFMPEG)/darwin-arm64/ffmpeg ]; then \
		cp $(VENDOR_FFMPEG)/darwin-arm64/ffmpeg $(SIDECAR_DIR)/ffmpeg-aarch64-apple-darwin; \
		cp $(VENDOR_FFMPEG)/darwin-arm64/ffprobe $(SIDECAR_DIR)/ffprobe-aarch64-apple-darwin; \
		chmod +x $(SIDECAR_DIR)/ffmpeg-aarch64-apple-darwin $(SIDECAR_DIR)/ffprobe-aarch64-apple-darwin; \
	fi
	@if [ -f $(VENDOR_FFMPEG)/windows-amd64/ffmpeg.exe ]; then \
		cp $(VENDOR_FFMPEG)/windows-amd64/ffmpeg.exe $(SIDECAR_DIR)/ffmpeg-x86_64-pc-windows-msvc.exe; \
		cp $(VENDOR_FFMPEG)/windows-amd64/ffprobe.exe $(SIDECAR_DIR)/ffprobe-x86_64-pc-windows-msvc.exe; \
	fi
	@echo '>>> 打包 macOS arm64...'
	@npx electron-builder --mac --arm64
	@echo '>>> 打包 Windows amd64...'
	@npx electron-builder --win --x64
	@echo '============================================'
	@echo '>>> 全平台打包完成!'
	@echo '>>> 产物位于: release/'
	@echo '============================================'

# ==================================================================================== #
# 清理
# ==================================================================================== #

## clean: 清理构建产物
clean:
	@echo '>>> 清理...'
	@rm -rf dist dist-electron release
	@rm -rf $(SIDECAR_DIR)/agent-* $(SIDECAR_DIR)/ffmpeg-* $(SIDECAR_DIR)/ffprobe-*
	@cd $(AGENT_DIR) && rm -rf build
	@echo '>>> OK'
