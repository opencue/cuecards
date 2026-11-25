/// <reference types="vite/client" />

declare module "virtual:cue-bundled-skills" {
  const skills: import("./bundled-skill-catalog").PublicSkill[];
  export default skills;
}

interface ImportMetaEnv {
  readonly VITE_CUE_MODE?: "local" | "demo";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __CUE_MODE__?: "local" | "demo";
}
