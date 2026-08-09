# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14-slim AS web
WORKDIR /app

COPY package.json bun.lock ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.json vite.config.ts ./
RUN bun install --frozen-lockfile
RUN bun run build:web

FROM oven/bun:1.3.14-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package.json bun.lock ./
COPY apps ./apps
COPY packages ./packages
RUN bun install --frozen-lockfile --production
COPY --from=web /app/apps/web/dist ./apps/web/dist
RUN mkdir -p /data /storage && chown -R bun:bun /data /storage

USER bun
EXPOSE 7331
VOLUME ["/data"]

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "const response = await fetch('http://127.0.0.1:7331/api/v1/health'); if (!response.ok) process.exit(1)"]

ENTRYPOINT ["bun", "apps/cli/src/main.ts", "serve"]
CMD ["--data-dir", "/data", "--host", "0.0.0.0", "--port", "7331"]
