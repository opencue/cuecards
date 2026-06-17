## Token-efficient repo workflow

For code questions in an indexed repo, keep exploration narrow:

- Start with `codegraph_context` for feature, architecture, bug-context, or "how does X work" questions.
- Use `codegraph_files` for structure and `codegraph_search` / `codegraph_explore` for targeted source. Prefer one batched explore over many reads.
- Fall back to `rg` or file reads only when CodeGraph lacks the file, the index is stale, or exact text/fixtures are needed.
- Do not run broad searches through `node_modules`, generated output, build/cache dirs, coverage, `.git`, or submodule dependency trees. Use targeted `rg --glob` excludes and cap output.
- Verify with the smallest proof first: focused test, touched command, or `cue validate <profile>` for profile edits. Do not run `cue validate --all`, full test suites, or broad audits unless requested, required by the touched surface, or a targeted check exposes cross-profile risk.

This keeps repo exploration out of the main transcript and lowers token burn.
