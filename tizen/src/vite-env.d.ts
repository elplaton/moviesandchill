/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  /** El servidor por fuera de casa, por si VITE_API_BASE no contesta. */
  readonly VITE_API_BASE_RESPALDO?: string;
  /** Solo lo define deploy.sh --debug; activa la consola remota. */
  readonly VITE_DEBUG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
