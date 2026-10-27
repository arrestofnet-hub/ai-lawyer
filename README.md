# AI Lawyer Kazakhstan

Kazakhstan legal-information plugin published by individual developer Габдысалих Санжар Болатулы.

The public release exposes nine read-only tools. Eight prepare structured inputs, checklists or document outlines; the skill uses them to analyze supplied facts and draft text. `fetch_kazakhstan_legal_act` retrieves a specified act from Kazakhstan’s legal reference bank. Tools do not independently perform legal analysis, calculate procedural deadlines, file documents, or provide persistent case memory.

Production MCP: https://mcp.ailawyer.kz/mcp

Run `npm install`, `node --check server.js`, `node scripts/validate-plugin.mjs`, and `MCP_URL=<target>/mcp node scripts/smoke.mjs`.

Deploy the updated server before rescanning tools in the OpenAI portal. The submission ZIP contains manifests, skills, assets and policies; it does not contain the server runtime or secrets.

## Smoke test and deployment

Release 1.0.1 deliberately renamed the public tools. Keep these names aligned with `server.js`, `skills/kz-legal/SKILL.md`, the review manifests and `scripts/smoke.mjs`:

| Legacy deployment | Public release 1.0.1 |
| --- | --- |
| `legal_case_intake` | `structure_legal_case` |
| `kz_law_research` | `prepare_kazakhstan_law_research` |
| `kz_official_act_fetch` | `fetch_kazakhstan_legal_act` |
| `case_strategy` | `prepare_case_strategy` |
| `contradiction_audit` | `prepare_contradiction_audit` |
| `second_lawyer_review` | `prepare_legal_position_review` |
| `analyze_legal_document` | `prepare_legal_document_analysis` |
| `compare_case_documents` | `prepare_document_comparison` |
| `draft_legal_document` | `prepare_legal_document_draft` |

The failed run [39721986552](https://github.com/arrestofnet-hub/ai-lawyer/actions/runs/39721986552) checked out `eec48c1`, but `/ready` reported deployment `f88fcb5`, version `0.8.0`. Its old readiness gate accepted that version and checked a different hostname from the MCP test. Do not change expected tool names to make a stale deployment pass.

Pull requests now run the smoke test against a local server from the checkout, including all nine public tools and eight template calls. The readiness regression tests run with `node --test scripts/wait-ready.test.mjs`.

Pushes to `main` and manual **MCP smoke test** runs also check production. Readiness is checked on the same origin as `MCP_URL`, against the version in `package.json`, `persistent_memory: disabled`, and the workflow's exact commit SHA. The public `/ready` response exposes `git_commit` from `RAILWAY_GIT_COMMIT_SHA` so an older deployment cannot pass solely because it shares a version number.

After merging, deploy the updated `main` commit to the production MCP service, then use **Actions → MCP smoke test → Run workflow → main**. A rerun of the old 22 October run uses its old commit and will not include this fix. A readiness failure reporting another SHA means deployment or domain routing still needs attention; it is not a reason to accept legacy tool aliases.

For a direct check after deployment:

```sh
export MCP_URL=https://mcp.ailawyer.kz/mcp
export EXPECTED_GIT_COMMIT=$(git rev-parse HEAD)
node scripts/wait-ready.mjs
node scripts/smoke.mjs
```
