# ==============================================================================
# GASTROWISE CORE SERVICE DOCKERFILE
# ==============================================================================
FROM node:24-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./

RUN npm ci --quiet

COPY libs/ ./libs/
COPY apps/core-service/ ./apps/core-service/
COPY uploads/ ./uploads/

RUN npm run build:shared && npm run build:core

# --- Production Image ---
FROM node:24-alpine AS runner

WORKDIR /usr/src/app

ENV NODE_ENV=production
ENV PORT=3001

COPY package*.json ./
RUN npm ci --omit=dev --quiet

COPY --from=builder /usr/src/app/dist/ ./dist/
COPY --from=builder /usr/src/app/uploads/ ./uploads/

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1

CMD ["node", "dist/apps/core-service/apps/core-service/src/main.js"]

