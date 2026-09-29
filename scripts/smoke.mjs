import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.env.MCP_URL || "https://ai-lawyer-kz-production.up.railway.app/mcp";
const client = new Client({ name: "ai-lawyer-kz-smoke", version: "1.0.0" });

const fail = (message) => {
  console.error(message);
  process.exitCode = 1;
};

try {
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));

  const listedTools = await client.listTools();
  const names = new Set((listedTools.tools || []).map((t) => t.name));
  const required = [
    "legal_case_intake",
    "case_memory_create",
    "case_memory_list",
    "case_memory_search",
    "case_memory_get",
    "case_memory_update",
    "case_memory_add_party",
    "case_memory_add_fact",
    "case_memory_add_event",
    "case_memory_add_deadline",
    "case_memory_update_deadline",
    "case_memory_add_document",
    "kz_official_act_fetch",
    "analyze_legal_document",
    "compare_case_documents",
    "contradiction_audit",
    "second_lawyer_review",
    "case_strategy",
    "draft_legal_document",
    "case_memory_delete"
  ];

  const missing = required.filter((n) => !names.has(n));
  if (missing.length) throw new Error("Missing MCP tools: " + missing.join(", "));

  const lawResult = await client.callTool({
    name: "kz_official_act_fetch",
    arguments: { document_id: "95109", language: "rus", page: 1 }
  });
  if (lawResult?.structuredContent?.error || !lawResult?.structuredContent?.source_url) {
    throw new Error("Official law fetch failed: " + JSON.stringify(lawResult?.structuredContent || {}));
  }

  const listResult = await client.callTool({
    name: "case_memory_list",
    arguments: { limit: 50 }
  });

  const cases = listResult?.structuredContent?.cases || [];
  let testCase = cases.find((c) => c?.title === "__system_e2e_test__");

  if (!testCase) {
    const created = await client.callTool({
      name: "case_memory_create",
      arguments: {
        title: "__system_e2e_test__",
        objective: "End-to-end MCP smoke test",
        stage: "system",
        summary: "Smoke test record"
      }
    });
    testCase = created?.structuredContent?.case;
  }

  if (!testCase?.id) throw new Error("Could not resolve system test case");

  const marker = "mcp-smoke:" + new Date().toISOString();
  const updated = await client.callTool({
    name: "case_memory_update",
    arguments: {
      case_id: testCase.id,
      content: marker,
      update_type: "system_test",
      source_ref: "github-actions"
    }
  });

  if (updated?.structuredContent?.error) {
    throw new Error("Memory update failed: " + updated.structuredContent.error);
  }

  const partyMarker = "Smoke Party " + Date.now();
  const party = await client.callTool({
    name: "case_memory_add_party",
    arguments: { case_id: testCase.id, name: partyMarker, role: "system-test" }
  });
  if (party?.structuredContent?.error) throw new Error("Party save failed");

  const deadlineMarker = "Smoke deadline " + Date.now();
  const deadline = await client.callTool({
    name: "case_memory_add_deadline",
    arguments: {
      case_id: testCase.id,
      title: deadlineMarker,
      status: "uncertain",
      notes: "Automated smoke-test deadline"
    }
  });
  const deadlineId = deadline?.structuredContent?.deadline?.id;
  if (!deadlineId) throw new Error("Deadline save failed");

  const deadlineUpdated = await client.callTool({
    name: "case_memory_update_deadline",
    arguments: {
      case_id: testCase.id,
      deadline_id: deadlineId,
      status: "completed",
      notes: "Automated smoke-test deadline completed"
    }
  });
  if (deadlineUpdated?.structuredContent?.deadline?.status !== "completed") {
    throw new Error("Deadline update failed");
  }

  const documentMarker = "smoke-document-" + Date.now() + ".txt";
  const documentSaved = await client.callTool({
    name: "case_memory_add_document",
    arguments: {
      case_id: testCase.id,
      filename: documentMarker,
      document_type: "system-test",
      summary: "Automated document memory test " + marker
    }
  });
  if (!documentSaved?.structuredContent?.document?.id) {
    throw new Error("Document save failed");
  }

  const searched = await client.callTool({
    name: "case_memory_search",
    arguments: { query: partyMarker, limit: 10 }
  });
  const searchCases = searched?.structuredContent?.cases || [];
  if (!searchCases.some((c) => c?.id === testCase.id)) {
    throw new Error("Context search failed");
  }

  const loaded = await client.callTool({
    name: "case_memory_get",
    arguments: { case_id: testCase.id }
  });

  const updates = loaded?.structuredContent?.updates || [];
  if (!updates.some((u) => u?.content === marker)) {
    throw new Error("Memory write/read roundtrip failed");
  }
  const parties = loaded?.structuredContent?.parties || [];
  if (!parties.some((p) => p?.name === partyMarker)) {
    throw new Error("Party readback failed");
  }
  const deadlines = loaded?.structuredContent?.deadlines || [];
  if (!deadlines.some((d) => d?.id === deadlineId && d?.status === "completed")) {
    throw new Error("Deadline readback failed");
  }
  const documents = loaded?.structuredContent?.documents || [];
  if (!documents.some((d) => d?.filename === documentMarker)) {
    throw new Error("Document readback failed");
  }

  console.log("SMOKE_OK");
  console.log(JSON.stringify({ endpoint, toolCount: names.size, caseId: testCase.id, marker }));
} catch (error) {
  fail(error?.stack || String(error));
} finally {
  try { await client.close(); } catch {}
}
