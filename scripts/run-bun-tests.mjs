import { spawn } from "node:child_process";
import { constants } from "node:os";

const timeout = Number(process.env.CUE_TEST_TIMEOUT_MS ?? 600_000);
if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2_147_483_647) {
  console.error("CUE_TEST_TIMEOUT_MS must be a positive integer of at most 2147483647 milliseconds.");
  process.exit(2);
}

// Bun's --timeout is per test; it cannot bound a wedged test process.
const group = process.platform !== "win32";
const child = spawn("bun", ["test", "--timeout", "30000", ...process.argv.slice(2)], {
  stdio: "inherit",
  detached: group,
});

function send(signal) {
  if (child.pid === undefined) return false;
  try {
    return group ? process.kill(-child.pid, signal) : child.kill(signal);
  } catch (error) {
    if (error.code !== "ESRCH") console.error(`Could not stop Bun tests: ${error.message}`);
    return false;
  }
}

function terminate(signal) {
  // The Bun process may exit before a subprocess that ignores the first signal.
  if (send(signal)) setTimeout(() => send("SIGKILL"), 1000);
}

let stopping = false;
function stop(signal, status) {
  if (stopping) return;
  stopping = true;
  clearTimeout(deadline);
  process.exitCode = status;
  terminate(signal);
}

const deadline = setTimeout(() => {
  console.error(`Bun test run timed out after ${timeout} ms (CUE_TEST_TIMEOUT_MS).`);
  stop("SIGTERM", 124);
}, timeout);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop(signal, 128 + constants.signals[signal]));
}

child.once("error", (error) => {
  clearTimeout(deadline);
  console.error(`Could not start Bun tests: ${error.message}`);
  if (!stopping) process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  clearTimeout(deadline);
  if (stopping) return;
  process.exitCode = code ?? (signal ? 128 + constants.signals[signal] : 1);
  // No-op if Bun left no other processes in its group.
  if (group) terminate("SIGTERM");
});
