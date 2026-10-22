# AI Lawyer Kazakhstan

Kazakhstan legal-information plugin published by individual developer Габдысалих Санжар Болатулы.

The public release exposes nine read-only tools. Eight prepare structured inputs, checklists or document outlines; the skill uses them to analyze supplied facts and draft text. `fetch_kazakhstan_legal_act` retrieves a specified act from Kazakhstan’s legal reference bank. Tools do not independently perform legal analysis, calculate procedural deadlines, file documents, or provide persistent case memory.

Production MCP: https://mcp.ailawyer.kz/mcp

Run `npm install`, `node --check server.js`, `node scripts/validate-plugin.mjs`, and `MCP_URL=<target>/mcp node scripts/smoke.mjs`.

Deploy the updated server before rescanning tools in the OpenAI portal. The submission ZIP contains manifests, skills, assets and policies; it does not contain the server runtime or secrets.
