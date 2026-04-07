#!/bin/bash
# 将 安装后签名.sh 注入到已构建的 DMG 中，使用户打开 DMG 时即可看到该脚本
set -euo pipefail

DMG_PATH="$1"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_SRC="${SCRIPT_DIR}/../安装后签名.sh"

if [ ! -f "$SCRIPT_SRC" ]; then
    echo "警告: 安装后签名.sh 不存在，跳过注入"
    exit 0
fi

if [ ! -f "$DMG_PATH" ]; then
    echo "错误: DMG 文件不存在: $DMG_PATH"
    exit 1
fi

echo ">>> 注入签名脚本到 DMG: $DMG_PATH"

MOUNT_DIR=$(mktemp -d)
RW_DMG="${DMG_PATH%.dmg}-rw.dmg"

hdiutil convert "$DMG_PATH" -format UDRW -o "$RW_DMG" -quiet
hdiutil attach "$RW_DMG" -mountpoint "$MOUNT_DIR" -quiet

cp "$SCRIPT_SRC" "$MOUNT_DIR/安装后签名.sh"
chmod +x "$MOUNT_DIR/安装后签名.sh"

hdiutil detach "$MOUNT_DIR" -quiet

rm -f "$DMG_PATH"
hdiutil convert "$RW_DMG" -format UDZO -o "$DMG_PATH" -quiet
rm -f "$RW_DMG"
rmdir "$MOUNT_DIR" 2>/dev/null || true

echo ">>> 签名脚本注入完成"
