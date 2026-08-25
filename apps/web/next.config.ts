import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // A minimal, self-contained server bundle — the shape the Dockerfile's
  // runtime stage expects (no full node_modules copy needed).
  output: "standalone",
  // Pinned to the workspace root rather than left to inference: with Bun
  // workspaces the dependencies this app imports live in the root
  // node_modules/.bun store, above apps/web, so tracing rooted at the app
  // directory would miss them. `next build` always runs with apps/web as its
  // cwd, which makes ../../ the repo root.
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
};

export default withNextIntl(nextConfig);
