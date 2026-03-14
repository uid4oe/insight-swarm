# ── Insight Swarm — Multi-stage build ──────────────────────────────────
#
# Stage 1: Install backend deps (production only)
# Stage 2: Build frontend static assets
# Stage 3: Backend runtime image
# Stage 4: Nginx serves frontend + reverse-proxies /api to backend
#

# ── Stage 1: backend deps ──────────────────────────────────────────────────
FROM node:22-alpine AS backend-deps

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
# Include devDependencies — tsx is needed at runtime for TS execution
RUN pnpm install --frozen-lockfile

# ── Stage 2: frontend build ───────────────────────────────────────────────
FROM node:22-alpine AS frontend-build

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

COPY shared/ /app/shared/
COPY frontend/ ./

ARG VITE_API_URL=""
ENV VITE_API_URL=${VITE_API_URL}
RUN pnpm exec vite build

# ── Stage 3: backend runtime ──────────────────────────────────────────────
FROM node:22-alpine AS backend

WORKDIR /app

COPY --from=backend-deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY shared/ ./shared/
COPY backend/ ./backend/

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/tasks || exit 1

EXPOSE 3000

CMD ["node", "--import", "tsx", "backend/serve.ts"]

# ── Stage 4: nginx (frontend + reverse proxy) ────────────────────────────
FROM nginx:alpine AS frontend

RUN apk add --no-cache curl
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD curl -fsS http://localhost/ || exit 1
