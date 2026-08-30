#!/usr/bin/env node

import { refreshAdvisoryFeed, recordUnverifiedFeedState, resolveFeedConfig } from "../lib/feed.mjs";

function usage() {
  process.stdout.write(
    [
      "Usage: node scripts/refresh_advisory_feed.mjs [options]",
      "",
      "Options:",
      "  --source <auto|remote|local>  Feed source strategy (default: auto)",
      "  --allow-unsigned              Temporary bypass for unsigned feeds (DANGEROUS)",
      "  --help                        Show this help",
      "",
      "Env/config overrides:",
      "  HERMES_ADVISORY_FEED_SOURCE",
      "  HERMES_ADVISORY_FEED_URL / HERMES_ADVISORY_FEED_SIG_URL",
      "  HERMES_ADVISORY_FEED_CHECKSUMS_URL / HERMES_ADVISORY_FEED_CHECKSUMS_SIG_URL",
      "  HERMES_LOCAL_ADVISORY_FEED / HERMES_LOCAL_ADVISORY_FEED_SIG",
      "  HERMES_LOCAL_ADVISORY_FEED_CHECKSUMS / HERMES_LOCAL_ADVISORY_FEED_CHECKSUMS_SIG",
      "  HERMES_ADVISORY_FEED_PUBLIC_KEY",
      "  HERMES_ADVISORY_ALLOW_UNSIGNED_FEED",
      "  HERMES_ADVISORY_VERIFY_CHECKSUM_MANIFEST",
      "  HERMES_ADVISORY_FEED_STATE_PATH",
      "  HERMES_ADVISORY_CACHED_FEED",
      "",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const parsed = {
    source: undefined,
    allowUnsigned: undefined,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }
    if (token === "--source") {
      parsed.source = String(argv[i + 1] || "").trim().toLowerCase();
      i += 1;
      continue;
    }
    if (token === "--allow-unsigned") {
      parsed.allowUnsigned = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (parsed.source && !["auto", "remote", "local"].includes(parsed.source)) {
    throw new Error(`Invalid --source value: ${parsed.source}`);
  }

  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const config = resolveFeedConfig(args);
  if (config.allowUnsigned) {
    process.stderr.write(
      "WARNING: unsigned advisory feed bypass is enabled. This weakens supply-chain guarantees and should only be used as a temporary emergency exception.\n",
    );
  }

  try {
    const result = await refreshAdvisoryFeed(args);
    process.stdout.write(
      `${JSON.stringify({
        level: "INFO",
        message: "advisory feed refreshed",
        status: result.status,
        source: result.source,
        advisories: result.advisoryCount,
        feed_version: result.feedVersion,
        state_path: result.statePath,
        cached_feed_path: result.cachedFeedPath,
        fallback_events: result.attemptedErrors,
      })}\n`,
    );
  } catch (error) {
    recordUnverifiedFeedState(error?.message || String(error), args);
    process.stderr.write(`CRITICAL: ${error?.message || String(error)}\n`);
    process.stderr.write(`CRITICAL: feed verification state recorded at ${config.statePath || "(unknown)"}\n`);
    process.exit(1);
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`CRITICAL: ${error?.message || String(error)}\n`);
  process.exit(1);
}
