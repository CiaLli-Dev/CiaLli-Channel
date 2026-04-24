FROM node:24-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build

ARG APP_PUBLIC_BASE_URL
ENV APP_PUBLIC_BASE_URL="${APP_PUBLIC_BASE_URL}"

COPY . .
RUN pnpm build

FROM deps AS prod-deps

ENV HUSKY=0
RUN pnpm prune --prod --ignore-scripts

FROM node:24-bookworm-slim AS web-runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321

WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist/client ./dist/client
COPY --from=build /app/dist/server ./dist/server
COPY --from=build /app/public ./public

EXPOSE 4321

CMD ["node", "./dist/server/entry.mjs"]

FROM node:24-bookworm-slim AS worker-runtime

ENV NODE_ENV=production
ENV PORT=4322

WORKDIR /app

COPY --from=build /app/dist/worker ./dist/worker

EXPOSE 4322

CMD ["node", "./dist/worker/entry.mjs"]
