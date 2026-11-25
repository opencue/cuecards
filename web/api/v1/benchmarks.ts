import { Benchmarks, handleBenchmarks } from "../../lib/benchmarks.js";

export async function benchmarkRequest(request: Request): Promise<Response> {
  return handleBenchmarks(request, {
    async getUser(headers) {
      const { auth } = await import("../../lib/auth.js");
      return (await auth.api.getSession({ headers }))?.user.id ?? null;
    },
    async submit(accountId, report) {
      const { getPool } = await import("../../lib/db.js");
      return new Benchmarks(getPool()).submit(accountId, report);
    },
    async list() {
      const { getPool } = await import("../../lib/db.js");
      return new Benchmarks(getPool()).list();
    },
  });
}

export default { fetch: benchmarkRequest };
