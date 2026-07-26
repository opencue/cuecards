/**
 * Tests for `cue completions` — pure exported helper completionScript().
 *
 * completionScript() is a pure function that returns a shell completion script
 * string. No filesystem or network access; no mocking needed.
 */

import { describe, test, expect } from "bun:test";
import { completionScript } from "./completions";
import { COMMANDS } from "./_index";

// ---------------------------------------------------------------------------
// bash completions
// ---------------------------------------------------------------------------

describe("completionScript(bash)", () => {
  test("returns a string", () => {
    const script = completionScript("bash");
    expect(typeof script).toBe("string");
    expect(script.length).toBeGreaterThan(100);
  });

  test("contains the bash completion function name", () => {
    const script = completionScript("bash");
    expect(script).toContain("_cue_completions");
  });

  test("registers the completion with `complete -F`", () => {
    const script = completionScript("bash");
    expect(script).toContain("complete -F _cue_completions cue");
  });

  test("contains COMPREPLY for bash auto-complete mechanism", () => {
    const script = completionScript("bash");
    expect(script).toContain("COMPREPLY");
  });

  test("includes top-level commands from the COMMANDS registry", () => {
    const script = completionScript("bash");
    for (const cmd of ["use", "list", "validate", "score"]) {
      expect(script).toContain(cmd);
    }
  });

  test("includes skills sub-commands", () => {
    const script = completionScript("bash");
    // SKILLS_SUBCOMMANDS is module-private; we check for a representative sample
    for (const sub of ["audit", "search", "lint"]) {
      expect(script).toContain(sub);
    }
  });

  test("references the skills command for sub-completion", () => {
    const script = completionScript("bash");
    expect(script).toContain("skills)");
  });

  test("does not start with a shebang", () => {
    const script = completionScript("bash");
    expect(script.trimStart()).not.toMatch(/^#!/);
  });

  test("starts with an eval-friendly comment header", () => {
    const script = completionScript("bash");
    expect(script).toContain("eval");
  });
});

// ---------------------------------------------------------------------------
// zsh completions
// ---------------------------------------------------------------------------

describe("completionScript(zsh)", () => {
  test("returns a string", () => {
    const script = completionScript("zsh");
    expect(typeof script).toBe("string");
    expect(script.length).toBeGreaterThan(100);
  });

  test("starts with #compdef directive", () => {
    const script = completionScript("zsh");
    expect(script.trimStart()).toMatch(/^#compdef cue/);
  });

  test("contains the _cue function definition", () => {
    const script = completionScript("zsh");
    expect(script).toContain("_cue()");
  });

  test("ends with the _cue invocation", () => {
    const script = completionScript("zsh");
    expect(script).toContain('_cue "$@"');
  });

  test("includes commands from COMMANDS registry with their summaries", () => {
    const script = completionScript("zsh");
    // Each COMMANDS entry is rendered as 'name:summary' in the zsh script.
    const cmdNames = Object.keys(COMMANDS);
    for (const name of cmdNames) {
      expect(script).toContain(`'${name}:`);
    }
  });

  test("includes skills sub-completion block", () => {
    const script = completionScript("zsh");
    expect(script).toContain("skills)");
  });

  test("includes _describe and _arguments zsh completion helpers", () => {
    const script = completionScript("zsh");
    expect(script).toContain("_describe");
    expect(script).toContain("_arguments");
  });
});

// ---------------------------------------------------------------------------
// Both shells: ensure the two outputs are distinct
// ---------------------------------------------------------------------------

describe("completionScript — bash vs zsh", () => {
  test("bash and zsh scripts are different", () => {
    const bash = completionScript("bash");
    const zsh = completionScript("zsh");
    expect(bash).not.toBe(zsh);
  });

  test("bash script does not contain zsh-specific markers", () => {
    const script = completionScript("bash");
    expect(script).not.toContain("#compdef");
    expect(script).not.toContain("_arguments");
  });

  test("zsh script does not contain bash-specific markers", () => {
    const script = completionScript("zsh");
    expect(script).not.toContain("COMPREPLY");
    expect(script).not.toContain("compgen");
  });
});

// ---------------------------------------------------------------------------
// run() — thin integration: correct shell dispatching and error for unknown
// ---------------------------------------------------------------------------

describe("completions run()", () => {
  function captureOut(fn: () => Promise<number>): Promise<{ stdout: string; stderr: string; code: number }> {
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    let out = "";
    let err = "";
    (process.stdout as any).write = (c: string | Uint8Array) => { out += String(c); return true; };
    (process.stderr as any).write = (c: string | Uint8Array) => { err += String(c); return true; };
    return fn()
      .then((code) => ({ stdout: out, stderr: err, code }))
      .finally(() => {
        (process.stdout as any).write = origOut;
        (process.stderr as any).write = origErr;
      });
  }

  test("run(['bash']) exits 0 and outputs bash script", async () => {
    const { run } = await import("./completions");
    const { code, stdout } = await captureOut(() => run(["bash"]));
    expect(code).toBe(0);
    expect(stdout).toContain("_cue_completions");
  });

  test("run(['zsh']) exits 0 and outputs zsh script", async () => {
    const { run } = await import("./completions");
    const { code, stdout } = await captureOut(() => run(["zsh"]));
    expect(code).toBe(0);
    expect(stdout).toContain("#compdef cue");
  });

  test("run(['fish']) exits 1 with unsupported-shell message on stderr", async () => {
    const { run } = await import("./completions");
    const { code, stderr } = await captureOut(() => run(["fish"]));
    expect(code).toBe(1);
    expect(stderr).toContain("fish");
    expect(stderr).toContain("Supported");
  });

  test("run([]) with no SHELL env falls back to bash output", async () => {
    const { run } = await import("./completions");
    const priorShell = process.env.SHELL;
    delete process.env.SHELL;
    try {
      const { code, stdout } = await captureOut(() => run([]));
      expect(code).toBe(0);
      // Falls back to bash: should contain bash markers
      expect(stdout).toContain("COMPREPLY");
    } finally {
      if (priorShell !== undefined) process.env.SHELL = priorShell;
    }
  });
});
