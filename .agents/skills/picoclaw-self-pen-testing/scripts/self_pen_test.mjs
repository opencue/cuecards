#!/usr/bin/env node
import fs from "node:fs";
import { runPicoclawSelfPenTest } from "../lib/self_pen_test.mjs";
import { stableStringify } from "../lib/format.mjs";

const idx = process.argv.indexOf("--profile");
if (idx < 0 || !process.argv[idx + 1]) throw new Error("--profile is required");

const profile = JSON.parse(fs.readFileSync(process.argv[idx + 1], "utf8"));
const result = runPicoclawSelfPenTest(profile);
console.log(stableStringify(result));
