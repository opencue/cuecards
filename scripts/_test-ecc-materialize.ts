import { loadProfile } from "../src/lib/profile-loader";
import { materializeRuntime } from "../src/lib/runtime-materializer";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const profile = await loadProfile("ecc");
console.log("rules    :", profile.rules);
console.log("commands :", profile.commands);
console.log("hooks    :", profile.hooks);

const out = await materializeRuntime({
  profile,
  agent: "claude-code",
  runtimeRoot: join(homedir(), ".config", "cue", "runtime"),
  skillSourceLookup: async (id) => resolve("resources/skills/skills", id),
  mcpRegistry: {},
  userClaudeMd: "",
  credentialsSource: undefined,
});
console.log("\nbuilt:", out);
