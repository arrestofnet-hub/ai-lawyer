import fs from "node:fs";

const server = fs.readFileSync("server.js", "utf8");
const plugin = JSON.parse(fs.readFileSync("plugin.json", "utf8"));
const codex = JSON.parse(fs.readFileSync(".codex-plugin/plugin.json", "utf8"));
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const submission = fs.readFileSync("SUBMISSION.md", "utf8");

for (const [name, version] of [
  ["plugin.json", plugin.version],
  [".codex-plugin/plugin.json", codex.version],
  ["package.json", pkg.version],
]) {
  if (version !== "0.8.0") throw new Error(`${name}: expected version 0.8.0, got ${version}`);
}

const shortDescription = plugin.extensions?.["com.openai"]?.interface?.shortDescription ?? "";
if (!shortDescription || [...shortDescription].length > 30) {
  throw new Error("shortDescription must be 1-30 characters");
}

const toolPattern = /server\.registerTool\(\s*"([^"]+)",\s*\{([\s\S]*?)\n\s*(?:title|description):/g;
const tools = [];
for (const match of server.matchAll(toolPattern)) {
  const [, name, config] = match;
  const annotation = config.match(/annotations:\s*\{([^}]+)\}/)?.[1] ?? "";
  for (const key of ["readOnlyHint", "openWorldHint", "destructiveHint"]) {
    if (!annotation.includes(key)) throw new Error(`${name}: missing ${key}`);
  }
  tools.push(name);
}
if (tools.length !== 21) throw new Error(`Expected 21 MCP tools, found ${tools.length}`);

const positives = (submission.match(/^### P\d\b/gm) || []).length;
const negatives = (submission.match(/^### N\d\b/gm) || []).length;
if (positives !== 5 || negatives !== 3) {
  throw new Error(`Expected 5 positive and 3 negative tests, found ${positives}/${negatives}`);
}

for (const required of [
  "/privacy",
  "/terms",
  "/support",
  "/.well-known/openai-apps-challenge",
  "/.well-known/oauth-protected-resource",
  "/oauth/consent",
]) {
  if (!server.includes(required)) throw new Error(`Missing publication endpoint ${required}`);
}

console.log(`plugin validation ok: ${tools.length} tools, 5 positive tests, 3 negative tests`);
