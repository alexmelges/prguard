FROM node:20-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc -p tsconfig.json

FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist/ dist/

# Data directory for SQLite persistence
# On Railway: attach a volume mounted at /data via the dashboard
RUN mkdir -p /data
ENV DATABASE_PATH=/data/prguard.db

EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production

CMD ["node", "./dist/src/start.js"]
