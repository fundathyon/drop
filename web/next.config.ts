import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // A minimal, self-contained server bundle — the shape the Dockerfile's
  // runtime stage expects (no full node_modules copy needed).
  output: "standalone",
};

export default withNextIntl(nextConfig);
