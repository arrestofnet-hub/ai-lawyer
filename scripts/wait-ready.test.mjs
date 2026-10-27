import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readinessError, waitForReadiness } from './wait-ready.mjs';

const ready = { ok: true, version: '1.0.1', mcp: '/mcp', persistent_memory: 'disabled', git_commit: 'current-sha' };
const expected = { version: '1.0.1', commit: 'current-sha' };

test('accepts the current public release without requiring private memory', () => {
  assert.equal(readinessError(200, ready, expected), null);
  assert.equal(readinessError(200, { ...ready, git_commit: null }), null);
});

test('rejects the 22 October response even though its HTTP and memory checks passed', () => {
  assert.match(readinessError(200, {
    ok: true, version: '0.8.0', mcp: '/mcp', persistent_memory: 'ok',
    git_commit: 'f88fcb5a461fe781c38e3180a7118c062d4ae554',
  }, expected), /version 0.8.0; expected 1.0.1/);
});

test('rejects an older or unidentified commit with the same release version', () => {
  for (const git_commit of ['older-sha', null, undefined]) {
    assert.match(readinessError(200, { ...ready, git_commit }, expected), /git_commit .*expected current-sha/);
  }
});

test('rejects HTTP errors, unhealthy bodies, wrong MCP paths and enabled memory', () => {
  assert.match(readinessError(503, ready, expected), /HTTP 503/);
  for (const body of [null, { ...ready, ok: false }, { ...ready, mcp: '/other' }, { ...ready, persistent_memory: 'ok' }]) {
    assert.ok(readinessError(200, body, expected));
  }
});

test('polls the MCP origin until the expected deployment is ready', async () => {
  const responses = [new Error('connection refused'), '<html>proxy error</html>', { ...ready, version: '0.8.0' }, { ...ready, git_commit: 'older-sha' }, ready];
  const logs = [];
  const body = await waitForReadiness('https://mcp.example.test/mcp', {
    ...expected, intervalMs: 1, timeoutMs: 2000, log: message => logs.push(message),
    fetchImpl: async url => {
      assert.equal(url.href, 'https://mcp.example.test/ready');
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return new Response(typeof next === 'string' ? next : JSON.stringify(next));
    },
  });
  assert.deepEqual(body, ready);
  assert.equal(responses.length, 0);
  assert.equal(logs.filter(line => line.startsWith('NOT_READY:')).length, 4);
  assert.match(logs.at(-1), /READY_OK:/);
});

test('fails with the final mismatch when deployment never catches up', async () => {
  await assert.rejects(waitForReadiness('http://localhost/mcp', {
    ...expected, intervalMs: 1, timeoutMs: 20, log: () => {},
    fetchImpl: async () => new Response(JSON.stringify({ ...ready, git_commit: 'older-sha' })),
  }), /did not become ready.*git_commit older-sha; expected current-sha/);
});
