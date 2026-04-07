#!/usr/bin/env bash
# 在 Agent 已监听端口时验证配置 PUT/POST 与重复 POST 覆盖（需本机已启动 ffagent agent，默认 15123）
set -euo pipefail
PORT="${1:-15123}"
BASE="http://127.0.0.1:${PORT}"

echo ">>> GET 不存在应失败"
curl -sS -o /dev/null -w "%{http_code}\n" "${BASE}/api/configs/openai-test" || true

echo ">>> PUT 不存在应失败（走 400 资源未找到）"
code=$(curl -sS -o /tmp/put1.json -w "%{http_code}" -X PUT "${BASE}/api/configs/openai-test" \
  -H "Content-Type: application/json" \
  -d '{"value":"{\"x\":1}"}' || true)
echo "HTTP $code"
head -c 200 /tmp/put1.json; echo

echo ">>> POST 创建"
curl -sS -X POST "${BASE}/api/configs" \
  -H "Content-Type: application/json" \
  -d '{"id":"openai-test","value":"{\"x\":1}"}' | head -c 300; echo

echo ">>> POST 同 id 再次应覆盖（upsert）"
curl -sS -X POST "${BASE}/api/configs" \
  -H "Content-Type: application/json" \
  -d '{"id":"openai-test","value":"{\"x\":2}"}' | head -c 300; echo

echo ">>> GET 应得到 x=2"
curl -sS "${BASE}/api/configs/openai-test"; echo

echo ">>> 清理（忽略失败）"
curl -sS -X DELETE "${BASE}/api/configs/openai-test" || true
echo
echo ">>> OK"
