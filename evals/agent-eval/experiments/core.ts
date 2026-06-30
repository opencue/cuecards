import type { ExperimentConfig } from '@vercel/agent-eval';
import { withProfile } from '../lib/with-profile.js';

// A/B variable = the cue PROFILE. Same task, same model across all three
// experiments — only the injected CLAUDE.md (persona + rules + skill-routing)
// changes. Compare pass rates: core vs gstack vs improver.
const config: ExperimentConfig = {
  agent: 'claude-code', // direct Anthropic; needs ANTHROPIC_API_KEY.
  //                       Swap to 'vercel-ai-gateway/claude-code' + AI_GATEWAY_API_KEY for the gateway.
  // model omitted → the claude CLI's native default, so the comparison is about
  // the profile, not the model.
  runs: 3, // a pass RATE is the signal, not a single run
  earlyExit: false, // run all N even after a success
  sandbox: 'docker', // Docker is available locally; no Vercel token needed
  scripts: ['build'],
  timeout: 600,
  ...withProfile('core'),
};

export default config;
