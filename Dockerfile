FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY tools ./tools
COPY public ./public
ARG SOURCE_SHA=local
ARG BUILD_RUN_ID=local
RUN SOURCE_SHA="$SOURCE_SHA" BUILD_RUN_ID="$BUILD_RUN_ID" npm run build
RUN npm prune --omit=dev --ignore-scripts

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e
WORKDIR /app
ENV NODE_ENV=production PORT=3000 LAB_ENVIRONMENT=local
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist/src ./dist/src
COPY --from=build --chown=node:node /app/dist/public ./dist/public
COPY --from=build --chown=node:node /app/dist/build-info.json ./dist/build-info.json
USER node
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
