FROM node:22-alpine AS deps
# No `apk add` and no C/C++ toolchain here, which keeps the Alpine package CDN
# out of the build entirely — it is slow or unreachable on some networks.
#
# The catch: better-sqlite3 ships a binding.gyp, so npm implicitly runs
# `node-gyp rebuild` during `npm ci` and fails without Python + a compiler.
# It also ships prebuilt binaries for every platform we care about
# (linuxmusl-x64 / linuxmusl-arm64 among them) and loads those at require()
# time, so that compile is redundant work. `--ignore-scripts` skips it.
#
# Every other native dependency (sharp, libvips, the Next.js SWC compiler)
# resolves to a prebuilt musl package too, so nothing else needs a build step.
# Verified end to end: install, next build, server boot, migrations, seed,
# and login all succeed with no compiler present.
WORKDIR /app
# Optional mirror for networks where registry.npmjs.org is slow. Override via
# NPM_REGISTRY in .env (see .env.example); defaults to the public registry.
ARG NPM_REGISTRY=https://registry.npmjs.org
COPY package.json package-lock.json ./
RUN npm config set registry "$NPM_REGISTRY" && npm ci --ignore-scripts

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV DATABASE_DIR=/app/data

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && mkdir -p /app/data /app/public/uploads \
  && chown -R nextjs:nodejs /app/data /app/public/uploads

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/drizzle ./drizzle

# Next's standalone output tracer does not currently pick up instrumentation.js
# (used here to run DB migrations/seed on boot) or its chunk — copy them in
# explicitly so the app doesn't silently boot against an empty database.
COPY --from=builder --chown=nextjs:nodejs /app/.next/server/instrumentation.js ./.next/server/instrumentation.js
COPY --from=builder --chown=nextjs:nodejs /app/.next/server/chunks ./.next/server/chunks

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
