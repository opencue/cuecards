import { materializeRuntime } from "../../src/lib/runtime-materializer";
import type { ResolvedProfile } from "../../profiles/_types";

const runtimeRoot = process.argv[2];
if (!runtimeRoot) throw new Error("runtime root argument is required");

const profile: ResolvedProfile = {
  name: "process-lock",
  description: "cross-process materialization lock test",
  agents: ["codex"],
  skills: { local: [{ id: "test/slow-skill" }], npx: [] },
  mcps: [],
  plugins: [],
  env: {},
  inheritanceChain: ["process-lock"],
};

const result = await materializeRuntime({
  profile,
  agent: "codex",
  runtimeRoot,
  skillSourceLookup: async () => {
    await Bun.sleep(150);
    return "/fake/skills/slow-skill";
  },
  mcpRegistry: {},
  userClaudeMd: "",
});

process.stdout.write(JSON.stringify(result));
