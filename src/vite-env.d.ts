/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MINIFLUX_URL: string;
  readonly VITE_MINIFLUX_API_TOKEN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
