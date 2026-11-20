# ==============================================================================
# GASTROWISE PLANNING SERVICE DOCKERFILE
# ==============================================================================
FROM node:24-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./

RUN npm ci --quiet

COPY libs/ ./libs/
COPY apps/planning-service/ ./apps/planning-service/

RUN npm run build:shared && npm run build:planning

# --- Production Image ---
FROM node:24-alpine AS runner

WORKDIR /usr/src/app

ENV NODE_ENV=production
ENV PORT=3003

COPY package*.json ./
RUN npm ci --omit=dev --quiet

COPY --from=builder /usr/src/app/dist/ ./dist/

EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3003/health || exit 1

CMD ["node", "dist/apps/planning-service/apps/planning-service/src/main.js"]

