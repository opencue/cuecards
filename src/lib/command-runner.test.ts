import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { runCommand } from "./command-runner";

let stderr = "";
let originalStderr: typeof process.stderr.write;

beforeEach(() => {
  stderr = "";
  originalStderr = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stderr.write = originalStderr;
});

describe("runCommand", () => {
  test("returns the command exit code", async () => {
    const code = await runCommand("status", [], {
      load: async () => ({ run: async () => 7 }),
    });
    expect(code).toBe(7);
    expect(stderr).toBe("");
  });

  test("reports loader failures as internal errors", async () => {
    const code = await runCommand("status", [], {
      load: async () => {
        throw new Error("load failed");
      },
    });
    expect(code).toBe(2);
    expect(stderr).toContain('internal error in "status"');
    expect(stderr).toContain("load failed");
  });

  test("reports command failures as internal errors", async () => {
    const code = await runCommand("status", [], {
      load: async () => ({
        run: async () => {
          throw new Error("status failed");
        },
      }),
    });
    expect(code).toBe(2);
    expect(stderr).toContain("status failed");
  });
});
