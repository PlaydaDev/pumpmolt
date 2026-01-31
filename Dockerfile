FROM node:24-bookworm-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm globally
RUN corepack enable && corepack prepare pnpm@latest --activate

# Create non-root user
RUN useradd -m -s /bin/bash moltuser

# Copy entrypoint script and fix line endings
COPY --chown=moltuser:moltuser entrypoint.sh /home/moltuser/entrypoint.sh
RUN sed -i 's/\r$//' /home/moltuser/entrypoint.sh && chmod +x /home/moltuser/entrypoint.sh

# Switch to non-root user
USER moltuser
WORKDIR /home/moltuser

# Clone official moltbot repo and build from source
RUN git clone https://github.com/moltbot/moltbot.git /home/moltuser/moltbot-src

WORKDIR /home/moltuser/moltbot-src
RUN pnpm install && pnpm ui:build && pnpm build

# Create persistent config directories
RUN mkdir -p /home/moltuser/.moltbot/agents/default/agent \
             /home/moltuser/.moltbot/skills \
             /home/moltuser/clawd/skills

WORKDIR /home/moltuser

# Expose gateway port
EXPOSE 18789

ENTRYPOINT ["/home/moltuser/entrypoint.sh"]
CMD ["gateway"]
