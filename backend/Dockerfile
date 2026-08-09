FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS dependencies

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/package.json backend/package-lock.json ./
RUN npm ci

COPY backend/prisma ./prisma
RUN npx prisma generate

FROM dependencies AS build

COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

FROM build AS migrate

ENV NODE_ENV=production
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS backup-crypto

ENV NODE_ENV=production
WORKDIR /tool

COPY deploy/backup-crypto.mjs ./backup-crypto.mjs

USER node
ENTRYPOINT ["node", "/tool/backup-crypto.mjs"]

FROM dependencies AS production-dependencies

RUN npm prune --omit=dev --omit=peer

FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS runtime

ARG BUILD_REVISION=unknown

LABEL org.opencontainers.image.revision="${BUILD_REVISION}"

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/package.json ./package.json
COPY --from=build /app/dist ./dist

USER node
EXPOSE 5000
STOPSIGNAL SIGTERM

CMD ["node", "dist/server.js"]
