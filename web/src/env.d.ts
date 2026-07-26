/// <reference types="vite/client" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Absolute base URL of the Drop API. Empty means same-origin (dev proxy). */
  readonly PUBLIC_DROP_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
