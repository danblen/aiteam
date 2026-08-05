#!/bin/sh
# Container entrypoint:
#   1. Generate claude-code-router config pointing at the same ZenGo gateway
#      as OpenCode (reuses OPENAI_* env vars).
#   2. Start claude-code-router in the background.
#   3. Start the aiteam server.

set -e

RCFILE=/root/.claude-code-router/config-router.json
KEY=${OPENAI_API_KEY:-}
MODEL=${OPENAI_MODEL:-deepseek-v4-flash}

mkdir -p "$(dirname "$RCFILE")"

if [ -n "$KEY" ]; then
  cat > "$RCFILE" <<EOF
{
  "server": { "port": 3456, "host": "127.0.0.1" },
  "routing": {
    "defaultProvider": "zengo",
    "providers": {
      "codewhisperer-primary": {
        "type": "codewhisperer",
        "endpoint": "https://codewhisperer.us-east-1.amazonaws.com",
        "authentication": { "type": "bearer", "credentials": {} },
        "settings": { "categoryMappings": { "default": false, "background": false, "thinking": false, "longcontext": false, "search": false } }
      },
      "shuaihong-openai": {
        "type": "openai",
        "endpoint": "https://api.shuaihong.ai",
        "authentication": { "type": "bearer", "credentials": { "apiKey": "" } },
        "settings": { "categoryMappings": { "default": false, "background": false, "thinking": false, "longcontext": false, "search": false } }
      },
      "zengo": {
        "type": "openai",
        "endpoint": "https://opencode.ai/zen/go/v1/chat/completions",
        "authentication": { "type": "bearer", "credentials": { "apiKey": "$KEY" } },
        "settings": {
          "categoryMappings": { "default": true, "background": true, "thinking": true, "longcontext": true, "search": true },
          "models": ["$MODEL"],
          "defaultModel": "$MODEL"
        }
      }
    }
  },
  "debug": { "enabled": false, "logLevel": "info", "traceRequests": false, "saveRequests": false, "logDir": "/root/.claude-code-router/logs" },
  "hooks": []
}
EOF
  echo "[start] wrote $RCFILE"
fi

# claude-code-router must be patched to accept empty text blocks (Claude Code sends them).
node scripts/patch-ccr.js || echo "[start] patch-ccr failed (continuing)"

# Start router if installed
if command -v ccr >/dev/null 2>&1; then
  nohup ccr start >/tmp/ccr.log 2>&1 &
  echo "[start] claude-code-router started"
fi

exec node server/index.js
