/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CUE_MODE?: "local" | "demo";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __CUE_MODE__?: "local" | "demo";
}
