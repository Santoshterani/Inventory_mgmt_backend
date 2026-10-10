# --- Base -------------------------------------------------------------
FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# --- Dependencies -------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# --- Runtime -------------------------------------------------------------
FROM base AS runtime
RUN apk add --no-cache curl \
  && addgroup -S ams && adduser -S ams -G ams

COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p logs && chown -R ams:ams /app

USER ams
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
