import { describe, test, expect, spyOn } from "bun:test";
import { showHelp } from "./help";

const USAGE = "Usage: cue <command> [options]\n";

describe("showHelp", () => {
  test("returns false and writes nothing when help flag is absent", () => {
    const spy = spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const result = showHelp(["some", "args"], USAGE);
      expect(result).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test("returns false and writes nothing for empty args", () => {
    const spy = spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      expect(showHelp([], USAGE)).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test("-h flag triggers help output and returns true", () => {
    const spy = spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const result = showHelp(["-h"], USAGE);
      expect(result).toBe(true);
      expect(spy).toHaveBeenCalledWith(USAGE);
    } finally {
      spy.mockRestore();
    }
  });

  test("--help flag triggers help output and returns true", () => {
    const spy = spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const result = showHelp(["--help"], USAGE);
      expect(result).toBe(true);
      expect(spy).toHaveBeenCalledWith(USAGE);
    } finally {
      spy.mockRestore();
    }
  });

  test("'help' as a word triggers help output and returns true", () => {
    const spy = spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const result = showHelp(["help"], USAGE);
      expect(result).toBe(true);
      expect(spy).toHaveBeenCalledWith(USAGE);
    } finally {
      spy.mockRestore();
    }
  });

  test("help flag mixed among other args is still detected", () => {
    const spy = spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      expect(showHelp(["--foo", "--help", "bar"], USAGE)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
