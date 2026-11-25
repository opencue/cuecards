import { Benchmarks } from "../lib/benchmarks.js";
import { getPool } from "../lib/db.js";

try {
  const pool = getPool();
  try {
    const cohorts = await new Benchmarks(pool).list();
    console.log(JSON.stringify({ source: "self-reported", cohorts }, null, 2));
  } finally {
    await pool.end();
  }
} catch {
  console.error("BENCHMARK_READ_FAILED: check authorized database access and the benchmark migration.");
  process.exitCode = 1;
}
