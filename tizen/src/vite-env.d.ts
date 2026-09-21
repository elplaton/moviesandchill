/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  /** Solo lo define deploy.sh --debug; activa la consola remota. */
  readonly VITE_DEBUG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
