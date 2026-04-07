.PHONY: help dev build/darwin-arm64 build/windows-amd64 build/linux-amd64 build/linux-arm64 build/all build/sidecar build/copy-ffmpeg build/frontend build/sync-version clean

AGENT_DIR := agent
SIDECAR_DIR := resources/binaries
VENDOR_FFMPEG := vendor/ffmpeg

# ==================================================================================== #
# 版本号：从 git tag 自动计算，与 agent/Makefile 保持一致
# ==================================================================================== #

RECENT_TAG := $(shell git describe --tags --abbrev=0 2>&1 | grep -v -e "fatal" -e "Try" || echo "v0.0.0")
BRANCH := $(shell git rev-parse --abbrev-ref HEAD)

ifeq ($(RECENT_TAG),v0.0.0)
	COMMITS := $(shell git rev-list --count HEAD)
else
	COMMITS := $(shell git log --first-parent --format='%ae' $(RECENT_TAG)..$(BRANCH) | wc -l)
	COMMITS := $(shell echo $(COMMITS) | sed 's/ //g')
endif

GIT_VERSION_MAJOR := $(shell echo $(RECENT_TAG) | cut -d. -f1 | sed 's/v//')
GIT_VERSION_MINOR := $(shell echo $(RECENT_TAG) | cut -d. -f2)
GIT_VERSION_PATCH := $(shell echo $(RECENT_TAG) | cut -d. -f3)
FINAL_PATCH := $(shell echo '$(GIT_VERSION_PATCH) $(COMMITS)' | awk '{print $$1 + $$2}')
VERSION := $(GIT_VERSION_MAJOR).$(GIT_VERSION_MINOR).$(FINAL_PATCH)
HASH_AND_DATE := $(shell git log -n1 --pretty=format:"%h-%cd" --date=format:%y%m%d | awk '{print $$1}')

help: ## 显示帮助
	@echo "FFAgent 构建命令 (version: $(VERSION)):"
	@echo ""
	@echo "  make dev                  开发模式 (编译 agent + 启动 Electron dev)"
	@echo "  make build/darwin-arm64   打包 macOS arm64 版本"
	@echo "  make build/windows-amd64  打包 Windows amd64 版本 (macOS 上需 Wine)"
	@echo "  make build/linux-amd64    打包 Linux amd64 版本"
	@echo "  make build/linux-arm64    打包 Linux arm64 版本"
	@echo "  make build/all            打包所有平台"
	@echo "  make clean                清理构建产物"
	@echo ""

# ==================================================================================== #
# 开发
# ==================================================================================== #

## dev: 开发模式启动
dev:
	@echo '>>> 编译 Go Agent (开发版本)...'
	@rm -rf $(AGENT_DIR)/agent
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

## build/sidecar/linux-amd64: 编译 Linux amd64 Go Agent
build/sidecar/linux-amd64:
	@cd $(AGENT_DIR) && make build/sidecar/linux-amd64

## build/sidecar/linux-arm64: 编译 Linux arm64 Go Agent
build/sidecar/linux-arm64:
	@cd $(AGENT_DIR) && make build/sidecar/linux-arm64

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

## build/copy-ffmpeg/linux-amd64: 复制 Linux amd64 ffmpeg
build/copy-ffmpeg/linux-amd64:
	@echo '>>> 复制 ffmpeg 二进制 (linux-amd64)...'
	@mkdir -p $(SIDECAR_DIR)
	@test -f $(VENDOR_FFMPEG)/linux-amd64/ffmpeg || (echo "错误: $(VENDOR_FFMPEG)/linux-amd64/ffmpeg 不存在，请先下载" && exit 1)
	@cp $(VENDOR_FFMPEG)/linux-amd64/ffmpeg $(SIDECAR_DIR)/ffmpeg-x86_64-unknown-linux-gnu
	@cp $(VENDOR_FFMPEG)/linux-amd64/ffprobe $(SIDECAR_DIR)/ffprobe-x86_64-unknown-linux-gnu
	@chmod +x $(SIDECAR_DIR)/ffmpeg-x86_64-unknown-linux-gnu $(SIDECAR_DIR)/ffprobe-x86_64-unknown-linux-gnu
	@echo '>>> OK'

## build/copy-ffmpeg/linux-arm64: 复制 Linux arm64 ffmpeg
build/copy-ffmpeg/linux-arm64:
	@echo '>>> 复制 ffmpeg 二进制 (linux-arm64)...'
	@mkdir -p $(SIDECAR_DIR)
	@test -f $(VENDOR_FFMPEG)/linux-arm64/ffmpeg || (echo "错误: $(VENDOR_FFMPEG)/linux-arm64/ffmpeg 不存在，请先下载" && exit 1)
	@cp $(VENDOR_FFMPEG)/linux-arm64/ffmpeg $(SIDECAR_DIR)/ffmpeg-aarch64-unknown-linux-gnu
	@cp $(VENDOR_FFMPEG)/linux-arm64/ffprobe $(SIDECAR_DIR)/ffprobe-aarch64-unknown-linux-gnu
	@chmod +x $(SIDECAR_DIR)/ffmpeg-aarch64-unknown-linux-gnu $(SIDECAR_DIR)/ffprobe-aarch64-unknown-linux-gnu
	@echo '>>> OK'

# ==================================================================================== #
# 前端
# ==================================================================================== #

## build/sync-version: 将 git tag 版本号同步写入 package.json 和 .env.production
build/sync-version:
	@echo '>>> 同步版本号 $(VERSION) ($(HASH_AND_DATE))...'
	@sed -i "" 's/"version": *"[^"]*"/"version": "$(VERSION)"/' package.json
	@echo '>>> OK'

## build/frontend: 构建前端 + Electron 主进程
build/frontend: build/sync-version
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
	@for f in release/*.dmg; do [ -f "$$f" ] && ./build/inject-signing-script.sh "$$f"; done
	@git checkout package.json
	@echo '============================================'
	@echo '>>> macOS arm64 打包完成! ($(VERSION))'
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
	@git checkout package.json
	@echo '============================================'
	@echo '>>> Windows amd64 打包完成! ($(VERSION))'
	@echo '>>> 产物位于: release/'
	@echo '============================================'

# ==================================================================================== #
# 打包 Linux amd64
# ==================================================================================== #

## build/linux-amd64: 一键打包 Linux amd64
build/linux-amd64: build/sidecar/linux-amd64 build/copy-ffmpeg/linux-amd64 build/frontend
	@echo '>>> 打包 Electron (Linux amd64)...'
	@npx electron-builder --linux --x64
	@git checkout package.json
	@echo '============================================'
	@echo '>>> Linux amd64 打包完成! ($(VERSION))'
	@echo '>>> 产物位于: release/'
	@echo '============================================'

# ==================================================================================== #
# 打包 Linux arm64
# ==================================================================================== #

## build/linux-arm64: 一键打包 Linux arm64
build/linux-arm64: build/sidecar/linux-arm64 build/copy-ffmpeg/linux-arm64 build/frontend
	@echo '>>> 打包 Electron (Linux arm64)...'
	@npx electron-builder --linux --arm64
	@git checkout package.json
	@echo '============================================'
	@echo '>>> Linux arm64 打包完成! ($(VERSION))'
	@echo '>>> 产物位于: release/'
	@echo '============================================'

# ==================================================================================== #
# 全平台打包 (macOS 上可同时构建 macOS + Windows)
# ==================================================================================== #

## build/all: 打包所有平台
build/all: build/sidecar build/frontend
	@echo '>>> 复制 FFmpeg 二进制...'
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
	@if [ -f $(VENDOR_FFMPEG)/linux-amd64/ffmpeg ]; then \
		cp $(VENDOR_FFMPEG)/linux-amd64/ffmpeg $(SIDECAR_DIR)/ffmpeg-x86_64-unknown-linux-gnu; \
		cp $(VENDOR_FFMPEG)/linux-amd64/ffprobe $(SIDECAR_DIR)/ffprobe-x86_64-unknown-linux-gnu; \
		chmod +x $(SIDECAR_DIR)/ffmpeg-x86_64-unknown-linux-gnu $(SIDECAR_DIR)/ffprobe-x86_64-unknown-linux-gnu; \
	fi
	@if [ -f $(VENDOR_FFMPEG)/linux-arm64/ffmpeg ]; then \
		cp $(VENDOR_FFMPEG)/linux-arm64/ffmpeg $(SIDECAR_DIR)/ffmpeg-aarch64-unknown-linux-gnu; \
		cp $(VENDOR_FFMPEG)/linux-arm64/ffprobe $(SIDECAR_DIR)/ffprobe-aarch64-unknown-linux-gnu; \
		chmod +x $(SIDECAR_DIR)/ffmpeg-aarch64-unknown-linux-gnu $(SIDECAR_DIR)/ffprobe-aarch64-unknown-linux-gnu; \
	fi
	@echo '>>> 打包 macOS arm64...'
	@npx electron-builder --mac --arm64
	@for f in release/*.dmg; do [ -f "$$f" ] && ./build/inject-signing-script.sh "$$f"; done
	@echo '>>> 打包 Windows amd64...'
	@npx electron-builder --win --x64
	@echo '>>> 打包 Linux amd64...'
	@npx electron-builder --linux --x64
	@echo '>>> 打包 Linux arm64...'
	@npx electron-builder --linux --arm64
	@git checkout package.json
	@echo '============================================'
	@echo '>>> 全平台打包完成! ($(VERSION))'
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
