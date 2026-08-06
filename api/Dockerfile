# Base image and shared runtime setup.
FROM --platform=linux/amd64 node:24.16.0-alpine AS base
RUN corepack enable pnpm
RUN mkdir /api && chown node:node /api
WORKDIR /api
USER node

# Install production dependencies only.
FROM base AS dependencies
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Install build dependencies and compile the app.
FROM base AS build
COPY package.json pnpm-lock.yaml .npmrc nest-cli.json tsconfig.json tsconfig.build.json ./
RUN pnpm install --frozen-lockfile
COPY src ./src
RUN pnpm build

# Assemble the production image.
FROM base AS production
ENV NODE_ENV=production
COPY --from=dependencies /api/node_modules ./node_modules
COPY --from=build /api/dist ./dist
COPY package.json ./
EXPOSE 3000
CMD ["pnpm", "run", "start:prod"]
