FROM node:24-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}" \
    HUSKY=0

RUN corepack enable && pnpm config set registry https://registry.npmmirror.com


FROM base AS build

WORKDIR /app
ARG APP_SITE_URL
ENV APP_SITE_URL=${APP_SITE_URL}

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build:docker


FROM node:24-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    DEPLOY_TARGET=docker \
    ENABLE_VERCEL_ANALYTICS=0

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules

EXPOSE 4321

CMD ["node", "./dist/server/entry.mjs"]
