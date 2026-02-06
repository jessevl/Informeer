# Informeer Docker Build
# Builds a production-ready static site served by nginx

# Build stage
FROM node:22-alpine AS builder
WORKDIR /app

# Install git for submodule support
RUN apk add --no-cache git

# Copy package files
COPY package*.json ./
COPY .npmrc ./

# Install dependencies
RUN npm ci --legacy-peer-deps

# Copy source code
COPY . .

# Initialize submodules if .git exists and frameer is empty
RUN if [ -d .git ] && [ ! -f src/frameer/package.json ]; then \
      git submodule update --init --recursive; \
    fi

# Build the application
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port 80
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost/health || exit 1
