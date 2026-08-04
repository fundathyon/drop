FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
# DROP_API_URL only matters at request time (every fetch reads it fresh from
# process.env at runtime, nothing is inlined at build time), so the build
# needs no server-side secrets — only NEXT_PUBLIC_* values would, and there
# are none here.
RUN bun run build

# next.config.ts sets output: "standalone", so the runtime image only needs
# the traced server bundle plus static assets — not the full node_modules.
FROM oven/bun:1-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
EXPOSE 3000
CMD ["bun", "server.js"]
