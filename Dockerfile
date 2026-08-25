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
# Where the SQLite era's database lives, read by the one-time import script.
ENV DATABASE_DIR=/app/data
# Uploads live outside public/ on purpose — see src/lib/uploads.ts.
ENV UPLOADS_DIR=/app/uploads

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && mkdir -p /app/data /app/uploads /app/backups \
  && chown -R nextjs:nodejs /app/data /app/uploads /app/backups

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/drizzle ./drizzle

# The standalone server never needs these, but one-off admin scripts
# (db:add-categories and friends — see their file header comments) are meant
# to be run by hand against the running container via
# `docker compose exec mbarete-app npm run db:<script>`. That needs tsx (a
# devDependency the standalone build's dependency tracing correctly omits)
# plus the script sources, which nothing imports at runtime. The @esbuild
# platform package must come along: --ignore-scripts skipped the postinstall
# that would embed the binary, so esbuild resolves it from that package at
# require() time. And .bin/tsx has to be a symlink made here — COPY would
# dereference it, and tsx's CLI imports sibling chunks relative to its real
# location, so a flattened copy in .bin/ cannot start.
COPY --from=deps /app/node_modules/tsx ./node_modules/tsx
COPY --from=deps /app/node_modules/esbuild ./node_modules/esbuild
COPY --from=deps /app/node_modules/@esbuild ./node_modules/@esbuild
# drizzle-orm and bcryptjs are production dependencies, but they are absent
# from the standalone node_modules all the same: only better-sqlite3 is in
# serverExternalPackages (next.config.ts), so Next bundles the other two into
# the server chunks — which tsx, running the raw sources, cannot resolve from.
COPY --from=deps /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=deps /app/node_modules/bcryptjs ./node_modules/bcryptjs
# pg is serverExternalPackages so the standalone server has it traced in, but
# the tsx-run scripts resolve from ./node_modules — and the one-time SQLite
# import additionally needs the old driver, which nothing else uses now.
COPY --from=deps /app/node_modules/pg ./node_modules/pg
COPY --from=deps /app/node_modules/pg-protocol ./node_modules/pg-protocol
COPY --from=deps /app/node_modules/pg-types ./node_modules/pg-types
COPY --from=deps /app/node_modules/pg-connection-string ./node_modules/pg-connection-string
COPY --from=deps /app/node_modules/pg-pool ./node_modules/pg-pool
COPY --from=deps /app/node_modules/pg-cloudflare ./node_modules/pg-cloudflare
COPY --from=deps /app/node_modules/pg-int8 ./node_modules/pg-int8
COPY --from=deps /app/node_modules/pgpass ./node_modules/pgpass
COPY --from=deps /app/node_modules/postgres-array ./node_modules/postgres-array
COPY --from=deps /app/node_modules/postgres-bytea ./node_modules/postgres-bytea
COPY --from=deps /app/node_modules/postgres-date ./node_modules/postgres-date
COPY --from=deps /app/node_modules/postgres-interval ./node_modules/postgres-interval
COPY --from=deps /app/node_modules/split2 ./node_modules/split2
COPY --from=deps /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json
RUN mkdir -p node_modules/.bin && ln -sf ../tsx/dist/cli.mjs node_modules/.bin/tsx

# Next's standalone output tracer does not currently pick up instrumentation.js
# (used here to run DB migrations/seed on boot) or its chunk — copy them in
# explicitly so the app doesn't silently boot against an empty database.
COPY --from=builder --chown=nextjs:nodejs /app/.next/server/instrumentation.js ./.next/server/instrumentation.js
COPY --from=builder --chown=nextjs:nodejs /app/.next/server/chunks ./.next/server/chunks

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
