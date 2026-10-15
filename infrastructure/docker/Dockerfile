FROM node:22-bookworm-slim AS workspace
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm db:generate

FROM workspace AS development
ENV NODE_ENV=development

FROM workspace AS migration
CMD ["pnpm", "db:migrate"]

FROM workspace AS api-build
RUN pnpm --filter @nexus/api build
RUN pnpm --filter @nexus/api deploy --prod --legacy /out/api

FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=api-build --chown=node:node /out/api/ ./
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]

FROM workspace AS web-build
ARG API_INTERNAL_URL=http://api:3001
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @nexus/web build

FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=web-build --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build --chown=node:node /workspace/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
