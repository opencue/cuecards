CREATE TABLE IF NOT EXISTS cue_benchmark_report (
  account_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  benchmark text NOT NULL,
  model text NOT NULL,
  codex_version text NOT NULL,
  codegraph_version text NOT NULL,
  pairs jsonb NOT NULL,
  PRIMARY KEY (account_id, benchmark, model)
);
