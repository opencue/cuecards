/**
 * Key-handling tests for the two live v2 prompts. @clack's `Prompt` takes its
 * streams as options, so a pair of PassThroughs stands in for the TTY and we
 * drive the prompts by emitting readline `keypress` events.
 */

import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { isCancel } from "@clack/core";

import { CardPrompt, type CardSuggestion } from "./card";
import { StackPalettePrompt, type PaletteRow } from "./palette";

interface Wired {
  input: PassThrough;
  output: PassThrough;
  press: (char: string | undefined, key?: Record<string, unknown>) => void;
}

function wire(): Wired {
  const input = new PassThrough() as PassThrough & { isTTY?: boolean; setRawMode?: () => void };
  const output = new PassThrough() as PassThrough & { columns?: number; rows?: number };
  input.isTTY = true;
  input.setRawMode = () => {};
  output.columns = 80;
  output.rows = 40;
  // Drain, or the PassThrough fills and the prompt's writes block.
  output.resume();
  return {
    input,
    output,
    press: (char, key = {}) => {
      input.emit("keypress", char, { name: char, ...key });
    },
  };
}

const suggestions: CardSuggestion[] = [
  { parts: ["rust"], labels: ["🦀 rust"], reasons: ["Cargo.toml"] },
  { parts: ["python"], labels: ["🐍 python"], reasons: ["pyproject.toml"] },
];

const rows: PaletteRow[] = [
  { value: "rust", label: "🦀 rust", section: "suggested", recommended: true },
  { value: "secops", label: "🔒 secops", section: "suggested" },
  { value: "medusa-next", label: "medusa-next", section: "commerce", conflicts: ["medusa-vite"] },
  { value: "medusa-vite", label: "medusa-vite", section: "commerce" },
];

describe("CardPrompt keys", () => {
  test("enter launches", async () => {
    const { input, output, press } = wire();
    const prompt = new CardPrompt({ cwd: "/p", suggestions, pin: true, input, output });
    const done = prompt.prompt();
    press(undefined, { name: "return" });
    expect(await done).toBe("launch");
  });

  test("tab cycles suggestions and wraps", async () => {
    const { input, output, press } = wire();
    const prompt = new CardPrompt({ cwd: "/p", suggestions, pin: true, input, output });
    const done = prompt.prompt();
    press(undefined, { name: "tab" });
    expect(prompt.index).toBe(1);
    press(undefined, { name: "tab" });
    expect(prompt.index).toBe(0);
    press(undefined, { name: "up" });
    expect(prompt.index).toBe(1);
    press(undefined, { name: "return" });
    await done;
  });

  test("e, / and a leave the card with their own action", async () => {
    for (const [char, action] of [
      ["e", "edit"],
      ["/", "search"],
      ["a", "all"],
    ] as const) {
      const { input, output, press } = wire();
      const prompt = new CardPrompt({ cwd: "/p", suggestions, pin: true, input, output });
      const done = prompt.prompt();
      press(char);
      expect(await done).toBe(action);
    }
  });

  test("p toggles the pin, and cannot when pinning is unavailable", async () => {
    const { input, output, press } = wire();
    const prompt = new CardPrompt({ cwd: "/p", suggestions, pin: true, input, output });
    const done = prompt.prompt();
    press("p");
    expect(prompt.pin).toBe(false);
    press("p");
    expect(prompt.pin).toBe(true);
    press(undefined, { name: "return" });
    await done;

    const second = wire();
    const locked = new CardPrompt({
      cwd: "/p",
      suggestions,
      pin: false,
      pinDisabled: true,
      input: second.input,
      output: second.output,
    });
    const lockedDone = locked.prompt();
    second.press("p");
    expect(locked.pin).toBe(false);
    second.press(undefined, { name: "return" });
    await lockedDone;
  });

  test("help swallows the next keypress instead of launching from behind it", async () => {
    const { input, output, press } = wire();
    const prompt = new CardPrompt({ cwd: "/p", suggestions, pin: true, input, output });
    const done = prompt.prompt();
    press("?");
    expect(prompt.help).toBe(true);
    press("e"); // closes help — must NOT open the palette
    expect(prompt.help).toBe(false);
    press("e"); // now it acts
    expect(await done).toBe("edit");
  });

  test("esc cancels", async () => {
    const { input, output, press } = wire();
    const prompt = new CardPrompt({ cwd: "/p", suggestions, pin: true, input, output });
    const done = prompt.prompt();
    press(undefined, { name: "escape" });
    expect(isCancel(await done)).toBe(true);
    expect(prompt.hardCancel).toBe(false);
  });

  test("ctrl-c is flagged as a hard cancel", async () => {
    const { input, output, press } = wire();
    const prompt = new CardPrompt({ cwd: "/p", suggestions, pin: true, input, output });
    const done = prompt.prompt();
    press("c", { name: "c", ctrl: true });
    expect(prompt.hardCancel).toBe(true);
    press(undefined, { name: "escape" });
    await done;
  });
});

describe("StackPalettePrompt keys", () => {
  test("keeps a large grouped palette within the terminal height", () => {
    const { input, output } = wire();
    output.rows = 40;
    const groupedRows: PaletteRow[] = Array.from({ length: 80 }, (_, index) => ({
      value: `profile-${index}`,
      label: `profile-${index}`,
      section: index === 0 ? "suggested" : `section-${Math.floor((index - 1) / 2)}`,
      recommended: index === 0,
    }));
    const prompt = new StackPalettePrompt({
      rows: groupedRows,
      selected: ["profile-0"],
      input,
      output,
    });

    const frame = prompt.renderFrame();

    expect(frame.split("\n").length).toBeLessThanOrEqual(output.rows);
    expect(frame).toContain("profile-0");
  });

  test("space toggles the focused row and enter returns the stack", async () => {
    const { input, output, press } = wire();
    const prompt = new StackPalettePrompt({ rows, input, output });
    const done = prompt.prompt();
    press(undefined, { name: "space" }); // rust
    press(undefined, { name: "down" });
    press(undefined, { name: "space" }); // secops
    press(undefined, { name: "return" });
    expect(await done).toEqual(["rust", "secops"]);
  });

  test("enter does nothing until something is selected", async () => {
    const { input, output, press } = wire();
    const prompt = new StackPalettePrompt({ rows, input, output });
    const done = prompt.prompt();
    press(undefined, { name: "return" });
    expect(prompt.state).not.toBe("submit");
    press(undefined, { name: "space" });
    press(undefined, { name: "return" });
    expect(await done).toEqual(["rust"]);
  });

  test("typing filters, backspace unfilters, and the cursor follows", async () => {
    const { input, output, press } = wire();
    const prompt = new StackPalettePrompt({ rows, input, output });
    const done = prompt.prompt();
    press("m");
    press("e");
    expect(prompt.query).toBe("me");
    expect(prompt.visibleRows().map((r) => r.value)).toEqual(["medusa-next", "medusa-vite"]);
    press(undefined, { name: "space" });
    press(undefined, { name: "backspace" });
    press(undefined, { name: "backspace" });
    expect(prompt.query).toBe("");
    press(undefined, { name: "return" });
    expect(await done).toEqual(["medusa-next"]);
  });

  test("a conflicting pick is stripped from the result", async () => {
    const { input, output, press } = wire();
    const prompt = new StackPalettePrompt({
      rows,
      selected: ["medusa-next"],
      input,
      output,
    });
    const done = prompt.prompt();
    press("v"); // filter down to medusa-vite
    press("i");
    press("t");
    press(undefined, { name: "space" });
    press(undefined, { name: "return" });
    expect(await done).toEqual(["medusa-next"]);
  });

  test("esc goes back rather than submitting", async () => {
    const { input, output, press } = wire();
    const prompt = new StackPalettePrompt({ rows, selected: ["rust"], input, output });
    const done = prompt.prompt();
    press(undefined, { name: "escape" });
    expect(isCancel(await done)).toBe(true);
    expect(prompt.hardCancel).toBe(false);
  });

  test("selecting a profile with no tally asks the caller to load it", async () => {
    const { input, output, press } = wire();
    const wanted: string[] = [];
    const prompt = new StackPalettePrompt({
      rows,
      input,
      output,
      onNeedTally: (v) => wanted.push(v),
    });
    const done = prompt.prompt();
    press(undefined, { name: "space" });
    expect(wanted).toEqual(["rust"]);
    press(undefined, { name: "return" });
    await done;
  });

  test("cursorAt starts the cursor on a named row", async () => {
    const { input, output, press } = wire();
    const prompt = new StackPalettePrompt({ rows, cursorAt: "medusa-next", input, output });
    const done = prompt.prompt();
    press(undefined, { name: "space" });
    press(undefined, { name: "return" });
    expect(await done).toEqual(["medusa-next"]);
  });
});
