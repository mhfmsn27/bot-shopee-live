# Production Dockerfile - Shopee Live View Bot Apps
FROM node:22-alpine AS production

# Install essential dependencies for native build tools (node:sqlite)
RUN apk add --no-cache python3 make g++ tzdata
ENV TZ=Asia/Jakarta

WORKDIR /app

# Salin package dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Salin seluruh kode aplikasi
COPY . .

# Buat direktori data, backups, dan wa-sessions jika belum ada
RUN mkdir -p /app/backend/data /app/backend/backups /app/backend/wa-sessions

# Expose HTTP port
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start server entrypoint
CMD ["node", "backend/src/server.js"]
