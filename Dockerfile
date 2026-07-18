# syntax=docker/dockerfile:1.7

FROM node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203 AS toolchain

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /workspace

FROM toolchain AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY tsconfig.json tsconfig.base.json ./
COPY apps/bot/package.json ./apps/bot/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY apps/bot ./apps/bot
COPY packages/db ./packages/db
COPY packages/shared ./packages/shared

RUN pnpm build
RUN pnpm --filter @salbot/bot deploy --prod /prod/bot

FROM node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203 AS runtime

ENV NODE_ENV=production

WORKDIR /app

# pnpm deploy resolves workspace links into a portable production dependency
# graph. Copy only the bot output, its manifest, and that production graph.
COPY --from=build --chown=node:node /prod/bot/package.json ./package.json
COPY --from=build --chown=node:node /prod/bot/dist ./dist
COPY --from=build --chown=node:node /prod/bot/node_modules ./node_modules

USER node

CMD ["node", "dist/index.js"]
