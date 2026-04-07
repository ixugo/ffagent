#!/bin/bash
# 对未签名的 FFAgent.app 进行 ad-hoc 本地签名并移除隔离属性，
# 解决 macOS Gatekeeper "已损坏/无法打开" 的问题。
# 使用方式：双击执行，或在终端运行 bash 安装后签名.sh

set -euo pipefail

APP_NAME="FFAgent"
APP_PATH="/Applications/${APP_NAME}.app"

if [ ! -d "$APP_PATH" ]; then
  echo "❌ 未在 /Applications 下找到 ${APP_NAME}.app"
  echo "   如果安装在其他位置，请将 .app 拖到 /Applications 后重试。"
  exit 1
fi

echo "🔐 正在对 ${APP_PATH} 进行本地 ad-hoc 签名..."
echo "   可能需要输入管理员密码。"
echo ""

# 移除隔离属性（网络下载标记）
sudo xattr -rd com.apple.quarantine "$APP_PATH"

# ad-hoc 签名：-s - 表示不使用开发者证书，仅本地有效
sudo codesign --force --deep --sign - "$APP_PATH"

echo ""
echo "✅ 签名完成！现在可以正常打开 ${APP_NAME} 了。"
