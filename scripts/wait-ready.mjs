import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

const { version: releaseVersion } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export function readinessError(status, body, { version = releaseVersion, commit } = {}) {
  if (status !== 200) return `HTTP ${status}`;
  if (body?.ok !== true) return 'ok must be true';
  if (body.version !== version) return `version ${body.version}; expected ${version}`;
  if (body.mcp !== '/mcp') return `mcp ${body.mcp}; expected /mcp`;
  if (body.persistent_memory !== 'disabled') return `persistent_memory ${body.persistent_memory}; expected disabled for the public release`;
  if (commit && body.git_commit !== commit) return `git_commit ${body.git_commit}; expected ${commit}`;
  return null;
}

export async function waitForReadiness(endpoint, {
  version = releaseVersion,
  commit,
  timeoutMs = 300_000,
  intervalMs = 10_000,
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  for (const [name, value] of Object.entries({ timeoutMs, intervalMs })) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  }
  // Readiness and MCP must use the same origin, including when MCP_URL is overridden.
  const url = new URL('/ready', endpoint);
  const deadline = Date.now() + timeoutMs;
  let lastError = 'No response';
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - Date.now()))),
      });
      const body = await response.json();
      lastError = readinessError(response.status, body, { version, commit });
      if (!lastError) {
        log(`READY_OK: ${url} version=${body.version} git_commit=${body.git_commit ?? 'unknown'}`);
        return body;
      }
    } catch (error) {
      lastError = String(error);
    }
    log(`NOT_READY: ${url}: ${lastError}`);
    const remaining = deadline - Date.now();
    if (remaining > 0) await setTimeout(Math.min(intervalMs, remaining));
  }
  throw new Error(`Deployment at ${url} did not become ready within ${timeoutMs}ms: ${lastError}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    await waitForReadiness(process.env.MCP_URL || 'https://mcp.ailawyer.kz/mcp', {
      commit: process.env.EXPECTED_GIT_COMMIT || undefined,
      timeoutMs: Number(process.env.READY_TIMEOUT_MS || 300_000),
      intervalMs: Number(process.env.READY_INTERVAL_MS || 10_000),
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
