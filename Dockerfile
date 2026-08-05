# ---- Runtime image ----
# This image provides the runtime environment (Node.js, CLI tools, sandbox users).
# Application code is mounted from the host at /app at runtime,
# so code changes only need `npm run build + docker restart`, not a full image rebuild.
FROM node:22-bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y git sudo && rm -rf /var/lib/apt/lists/*

# Git 安全配置：沙箱用户（sandbox-10000~10199）需要能操作工作目录
RUN git config --system safe.directory '*'

# Install CLI tools
# claude-code-router routes Claude Code to the same OpenAI-compatible gateway
# (ZenGo / deepseek-v4-flash) used by OpenCode, doing Anthropic<->OpenAI
# protocol + tool-format transformation.
RUN npm install -g @anthropic-ai/claude-code opencode-ai claude-code-router

# Patch claude-code-router to accept empty-string text content blocks
# (Claude Code sends them; stock validation rejects them and breaks tool calls).
COPY scripts/patch-ccr.js /usr/local/bin/patch-ccr.js
RUN node /usr/local/bin/patch-ccr.js

# Pre-create sandbox users for isolation (10000 ~ 10199)
RUN for i in $(seq 10000 10199); do \
      useradd --no-log-init -M -K UID_MIN=$i -u $i sandbox-$i 2>/dev/null; \
    done

# Allow the server (running as root) to switch to sandbox users via spawn uid
# No sudo needed — Node.js `spawn({uid})` works when running as root.

WORKDIR /app

# Expose backend port
EXPOSE 5110

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:5110/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Start the backend server (serves both API and built frontend).
# The entrypoint first generates the ccr config from OPENAI_* env, starts
# claude-code-router, then starts the server.
ENV NODE_ENV=production
COPY scripts/start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh
CMD ["/usr/local/bin/start.sh"]
