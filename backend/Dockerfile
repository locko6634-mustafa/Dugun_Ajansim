FROM node:22.23.2-alpine3.23@sha256:46825fbbd4e996a78b7a2cdc08d75e38a5a505bdab95dcda55605359bf124bc6 AS dependencies

WORKDIR /app

RUN apk upgrade --no-cache \
    && apk add --no-cache openssl

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
COPY deploy/parse-pii-maintenance-result.mjs /usr/local/lib/dugun-ajansim/parse-pii-maintenance-result.mjs
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg
USER node
CMD ["node", "dist/scripts/runPrismaMigrate.js"]

FROM node:22.23.2-alpine3.23@sha256:46825fbbd4e996a78b7a2cdc08d75e38a5a505bdab95dcda55605359bf124bc6 AS backup-crypto

ENV NODE_ENV=production
WORKDIR /tool

RUN apk upgrade --no-cache

COPY deploy/backup-crypto.mjs ./backup-crypto.mjs
COPY deploy/file-secrets.mjs ./file-secrets.mjs

RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg

USER node
ENTRYPOINT ["node", "/tool/backup-crypto.mjs"]

FROM dependencies AS production-dependencies

RUN npm prune --omit=dev --omit=peer

FROM node:22.23.2-alpine3.23@sha256:46825fbbd4e996a78b7a2cdc08d75e38a5a505bdab95dcda55605359bf124bc6 AS runtime

ARG BUILD_REVISION=unknown

LABEL org.opencontainers.image.revision="${BUILD_REVISION}"

ENV NODE_ENV=production
WORKDIR /app

RUN apk upgrade --no-cache \
    && apk add --no-cache openssl \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/package.json ./package.json
COPY --from=build /app/dist ./dist

USER node
EXPOSE 5000
STOPSIGNAL SIGTERM

CMD ["node", "dist/server.js"]
