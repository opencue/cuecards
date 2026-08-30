import { describe, expect, test } from "bun:test";

import {
  installRecommendedTooling,
  runGlobalOnboarding,
  type RecommendedToolingCommand,
} from "./init";

describe("recommended first-run tooling", () => {
  test("installs CodeGraph once, then initializes the current repository", () => {
    const calls: RecommendedToolingCommand[] = [];

    const result = installRecommendedTooling({
      cwd: "/tmp/example-repo",
      commandExists: () => false,
      runCommand: (command) => {
        calls.push(command);
        return { status: 0 };
      },
    });

    expect(result).toEqual({ installed: true, initialized: true });
    expect(calls).toEqual([
      {
        command: "npm",
        args: ["install", "-g", "@colbymchenry/codegraph"],
        cwd: "/tmp/example-repo",
      },
      {
        command: "npm",
        args: ["exec", "--global", "--", "codegraph", "init", "-i"],
        cwd: "/tmp/example-repo",
      },
    ]);
  });

  test("does not reinstall CodeGraph when it is already available", () => {
    const calls: RecommendedToolingCommand[] = [];

    const result = installRecommendedTooling({
      cwd: "/tmp/example-repo",
      commandExists: () => true,
      runCommand: (command) => {
        calls.push(command);
        return { status: 0 };
      },
    });

    expect(result).toEqual({ installed: false, initialized: true });
    expect(calls).toEqual([
      {
        command: "codegraph",
        args: ["init", "-i"],
        cwd: "/tmp/example-repo",
      },
    ]);
  });

  test("does not claim initialization when the global install fails", () => {
    const calls: RecommendedToolingCommand[] = [];

    const result = installRecommendedTooling({
      cwd: "/tmp/example-repo",
      commandExists: () => false,
      runCommand: (command) => {
        calls.push(command);
        return { status: 1, stderr: "registry unavailable" };
      },
    });

    expect(result).toEqual({ installed: false, initialized: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("npm");
  });

  test("non-interactive onboarding never installs global tooling", async () => {
    let commands = 0;

    const ok = await runGlobalOnboarding({
      nonInteractive: true,
      recommendedTooling: {
        commandExists: () => false,
        runCommand: () => {
          commands++;
          return { status: 0 };
        },
      },
    });

    expect(ok).toBe(true);
    expect(commands).toBe(0);
  });
});
