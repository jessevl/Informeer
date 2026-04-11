# ============================================================
# Informeer — unified image (frontend + API)
# ============================================================
# Stage 1: Build the React frontend with Node
# Stage 2: Build the Bun API
# Stage 3: Production image — Bun serves both API and static files
# ============================================================

# --- Frontend build ---
FROM node:22-alpine AS frontend-builder
WORKDIR /app

# Install git for submodule support
RUN apk add --no-cache git

COPY frontend/package*.json .npmrc ./
RUN npm ci --legacy-peer-deps

COPY frontend/ .

# Initialize submodules if needed
RUN if [ -d .git ] && [ ! -f src/frameer/package.json ]; then \
      git submodule update --init --recursive; \
    fi

ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run build

# --- API build ---
FROM oven/bun:1-alpine AS api-builder
WORKDIR /app

COPY api/package.json api/bun.lock* ./
RUN bun install --frozen-lockfile

COPY api/ .
RUN bun build src/index.ts --outdir dist --target bun

# --- Production ---
FROM oven/bun:1-alpine
WORKDIR /app

# Copy API
COPY --from=api-builder /app/dist ./dist
COPY --from=api-builder /app/package.json ./
COPY --from=api-builder /app/node_modules ./node_modules

# Copy built frontend into public/ (served by Hono)
COPY --from=frontend-builder /app/dist ./public

# Create data directories
RUN mkdir -p /data/cache/pdfs /data/cache/covers /data/books

EXPOSE 3011
VOLUME ["/data"]

ENV PORT=3011
ENV HOST=0.0.0.0
ENV DATABASE_PATH=/data/informeer.db
ENV DATA_DIR=/data
ENV FRONTEND_DIR=./public

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -q --spider http://localhost:3011/health || exit 1

CMD ["bun", "run", "dist/index.js"]
