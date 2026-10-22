# syntax=docker/dockerfile:1

# Static ffmpeg and ffprobe builds (with libopus, used by the pause chunker)
FROM mwader/static-ffmpeg:9.0.2 AS ffmpeg

FROM node:24-slim AS build
WORKDIR /app
# package.json has no packageManager field, so pin the pnpm the lockfile was written with
ARG PNPM_VERSION=11.27.0
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# minimum-release-age would refuse packages the lockfile already pins
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
	pnpm install --frozen-lockfile --config.minimum-release-age=0
COPY . .
RUN pnpm build
# Only "dependencies" stay external in the adapter-node bundle; the rest is bundled into build/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
	pnpm prune --prod --ignore-scripts --config.minimum-release-age=0

FROM node:24-slim
WORKDIR /app
COPY --from=ffmpeg /ffmpeg /ffprobe /usr/local/bin/
ENV NODE_ENV=production \
	PORT=3000 \
	BODY_SIZE_LIMIT=50M \
	PROTOCOL_HEADER=x-forwarded-proto \
	HOST_HEADER=x-forwarded-host \
	ADDRESS_HEADER=x-forwarded-for \
	DATA_DIR=/data
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/build ./build
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
	CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "build"]
