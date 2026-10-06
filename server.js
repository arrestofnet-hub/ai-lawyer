import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT ?? 8787);
const MCP_PATH = "/mcp";
const MEMORY_URL = process.env.SUPABASE_MEMORY_URL;
const MEMORY_API_KEY = process.env.SUPABASE_MEMORY_API_KEY;
const SUPABASE_URL = (process.env.SUPABASE_URL || "https://xfpjxnnuvxmescjbndxo.supabase.co").replace(/\/$/, "");
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const PUBLIC_OAUTH_ENABLED = false; // 0.9.0 public release: memory/OAuth tools are intentionally disabled
const OAUTH_ISSUER_URL = process.env.OAUTH_ISSUER_URL || `${SUPABASE_URL}/auth/v1`;
const MCP_RESOURCE_URL = (process.env.MCP_RESOURCE_URL || "https://mcp.ailawyer.kz").replace(/\/$/, "");
const MEMORY_OAUTH_SCOPES = ["email"];
const OPENAI_APPS_CHALLENGE_TOKEN = process.env.OPENAI_APPS_CHALLENGE_TOKEN || "";

async function memoryRequest(payload) {
  if (!MEMORY_URL || !MEMORY_API_KEY) {
    throw new Error("Persistent memory is not configured");
  }
  const response = await fetch(MEMORY_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ai-lawyer-key": MEMORY_API_KEY,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `Memory API failed with HTTP ${response.status}`);
  }
  return data;
}

class AuthRequiredError extends Error {}

const encodeFilter = (value) => encodeURIComponent(String(value));

async function supabaseRest(path, { token, method = "GET", body, prefer } = {}) {
  if (!SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Supabase publishable key is not configured");
  }
  const headers = {
    "apikey": SUPABASE_PUBLISHABLE_KEY,
    "authorization": `Bearer ${token}`,
    "accept": "application/json",
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (prefer) headers["prefer"] = prefer;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await response.text();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = { raw }; }
  }
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Supabase REST failed with HTTP ${response.status}`);
  }
  return data;
}

const firstRow = (data) => Array.isArray(data) ? data[0] ?? null : data ?? null;
const CASE_PUBLIC_FIELDS = "id,title,objective,jurisdiction,stage,summary,current_strategy,next_step,status,metadata";
const PARTY_PUBLIC_FIELDS = "name,role,organization,notes,metadata";
const FACT_PUBLIC_FIELDS = "category,statement,source_ref,event_date,confidence,metadata";
const EVENT_PUBLIC_FIELDS = "event_date,event_time,event_type,description,source_ref,metadata";
const DEADLINE_PUBLIC_FIELDS = "id,title,due_at,deadline_type,legal_basis,source_ref,status,notes";
const DOCUMENT_PUBLIC_FIELDS = "filename,document_type,document_date,source_party,summary,extracted_metadata";
const UPDATE_PUBLIC_FIELDS = "update_type,content,delta,source_ref,created_at";

async function authenticatedMemoryRequest(payload, authContext) {
  const token = authContext?.token;
  const subject = authContext?.subject;
  if (!token || !subject) throw new AuthRequiredError("Authentication required");

  const action = payload?.action;
  if (action === "list_cases") {
    const limit = Math.max(1, Math.min(Number(payload.limit || 20), 50));
    const data = await supabaseRest(
      `cases?select=${CASE_PUBLIC_FIELDS}&status=neq.deleted&order=updated_at.desc&limit=${limit}`,
      { token }
    );
    return { cases: data || [] };
  }

  if (action === "search_cases") {
    const data = await supabaseRest("rpc/search_ai_lawyer_cases_user", {
      token,
      method: "POST",
      body: { p_query: String(payload.query || ""), p_limit: Math.max(1, Math.min(Number(payload.limit || 20), 50)) },
    });
    return { cases: data || [] };
  }

  if (action === "create_case") {
    const data = await supabaseRest(`cases?select=${CASE_PUBLIC_FIELDS}`, {
      token,
      method: "POST",
      prefer: "return=representation",
      body: {
        owner_subject: subject,
        title: payload.title,
        objective: payload.objective ?? null,
        jurisdiction: payload.jurisdiction ?? "KZ",
        stage: payload.stage ?? null,
        summary: payload.summary ?? null,
        current_strategy: payload.current_strategy ?? null,
        next_step: payload.next_step ?? null,
        status: payload.status ?? "active",
        metadata: payload.metadata ?? {},
      },
    });
    return { case: firstRow(data) };
  }

  if (action === "get_case") {
    const id = encodeFilter(payload.case_id);
    const cases = await supabaseRest(`cases?id=eq.${id}&status=neq.deleted&select=${CASE_PUBLIC_FIELDS}`, { token });
    const c = firstRow(cases);
    if (!c) throw new Error("case not found");
    const [parties, facts, events, deadlines, documents, updates] = await Promise.all([
      supabaseRest(`case_parties?case_id=eq.${id}&select=${PARTY_PUBLIC_FIELDS}&order=created_at.asc`, { token }),
      supabaseRest(`case_facts?case_id=eq.${id}&select=${FACT_PUBLIC_FIELDS}&order=created_at.asc`, { token }),
      supabaseRest(`case_events?case_id=eq.${id}&select=${EVENT_PUBLIC_FIELDS}&order=event_date.asc.nullslast`, { token }),
      supabaseRest(`case_deadlines?case_id=eq.${id}&select=${DEADLINE_PUBLIC_FIELDS}&order=due_at.asc.nullslast`, { token }),
      supabaseRest(`case_documents?case_id=eq.${id}&select=${DOCUMENT_PUBLIC_FIELDS}&order=created_at.asc`, { token }),
      supabaseRest(`case_updates?case_id=eq.${id}&select=${UPDATE_PUBLIC_FIELDS}&order=created_at.desc&limit=100`, { token }),
    ]);
    return { case: c, parties: parties || [], facts: facts || [], events: events || [], deadlines: deadlines || [], documents: documents || [], updates: updates || [] };
  }

  if (action === "update_case") {
    const allowed = ["title","objective","stage","summary","current_strategy","next_step","status","metadata"];
    const patch = {};
    for (const key of allowed) if (key in payload) patch[key] = payload[key];
    const data = await supabaseRest(`cases?id=eq.${encodeFilter(payload.case_id)}&select=${CASE_PUBLIC_FIELDS}`, {
      token, method: "PATCH", prefer: "return=representation", body: patch,
    });
    const row = firstRow(data);
    if (!row) throw new Error("case not found");
    return { case: row };
  }

  if (action === "delete_case") {
    if (payload.confirm !== true) throw new Error("explicit confirmation required");
    const data = await supabaseRest(`cases?id=eq.${encodeFilter(payload.case_id)}&select=id,title`, {
      token, method: "DELETE", prefer: "return=representation",
    });
    const row = firstRow(data);
    if (!row) throw new Error("case not found");
    return { deleted: row };
  }

  const caseId = encodeFilter(payload.case_id);
  const own = await supabaseRest(`cases?id=eq.${caseId}&status=neq.deleted&select=id&limit=1`, { token });
  if (!firstRow(own)) throw new Error("case not found");

  const inserts = {
    add_party: ["case_parties", {
      case_id: payload.case_id, name: payload.name, role: payload.role ?? null,
      organization: payload.organization ?? null, notes: payload.notes ?? null, metadata: payload.metadata ?? {},
    }, "party"],
    add_deadline: ["case_deadlines", {
      case_id: payload.case_id, title: payload.title, due_at: payload.due_at ?? null,
      deadline_type: payload.deadline_type ?? null, legal_basis: payload.legal_basis ?? null,
      source_ref: payload.source_ref ?? null, status: payload.status ?? "open", notes: payload.notes ?? null,
    }, "deadline"],
    add_fact: ["case_facts", {
      case_id: payload.case_id, category: payload.category, statement: payload.statement,
      source_ref: payload.source_ref ?? null, event_date: payload.event_date ?? null,
      confidence: payload.confidence ?? null, metadata: payload.metadata ?? {},
    }, "fact"],
    add_event: ["case_events", {
      case_id: payload.case_id, event_date: payload.event_date ?? null, event_time: payload.event_time ?? null,
      event_type: payload.event_type ?? null, description: payload.description,
      source_ref: payload.source_ref ?? null, metadata: payload.metadata ?? {},
    }, "event"],
    add_document: ["case_documents", {
      case_id: payload.case_id, filename: payload.filename ?? null, document_type: payload.document_type ?? null,
      document_date: payload.document_date ?? null, source_party: payload.source_party ?? null,
      sha256: payload.sha256 ?? null, storage_path: payload.storage_path ?? null,
      summary: payload.summary ?? null, extracted_metadata: payload.extracted_metadata ?? {},
    }, "document"],
    add_update: ["case_updates", {
      case_id: payload.case_id, update_type: payload.update_type ?? "note", content: payload.content ?? null,
      delta: payload.delta ?? {}, source_ref: payload.source_ref ?? null,
    }, "update"],
  };

  if (inserts[action]) {
    const [table, row, key] = inserts[action];
    const selectFields = {
      case_parties: PARTY_PUBLIC_FIELDS,
      case_deadlines: DEADLINE_PUBLIC_FIELDS,
      case_facts: FACT_PUBLIC_FIELDS,
      case_events: EVENT_PUBLIC_FIELDS,
      case_documents: DOCUMENT_PUBLIC_FIELDS,
      case_updates: UPDATE_PUBLIC_FIELDS,
    }[table];
    const data = await supabaseRest(`${table}?select=${selectFields}`, {
      token, method: "POST", prefer: "return=representation", body: row,
    });
    return { [key]: firstRow(data) };
  }

  if (action === "update_deadline") {
    const allowed = ["title","due_at","deadline_type","legal_basis","source_ref","status","notes"];
    const patch = {};
    for (const key of allowed) if (key in payload) patch[key] = payload[key];
    const data = await supabaseRest(
      `case_deadlines?id=eq.${encodeFilter(payload.deadline_id)}&case_id=eq.${caseId}&select=${DEADLINE_PUBLIC_FIELDS}`,
      { token, method: "PATCH", prefer: "return=representation", body: patch }
    );
    const row = firstRow(data);
    if (!row) throw new Error("deadline not found");
    return { deadline: row };
  }

  throw new Error("unknown action");
}

function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

async function verifySupabaseUserToken(token) {
  if (!token || !SUPABASE_PUBLISHABLE_KEY) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      "apikey": SUPABASE_PUBLISHABLE_KEY,
      "authorization": `Bearer ${token}`,
      "accept": "application/json",
    },
  });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  if (!user?.id) return null;

  const claims = decodeJwtPayload(token);
  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud].filter(Boolean);
  if (!claims || claims.sub !== user.id || claims.iss !== OAUTH_ISSUER_URL || !aud.includes("authenticated") || Number(claims.exp || 0) <= now) {
    return null;
  }
  return { token, subject: String(user.id), email: user.email || null, client_id: claims.client_id || null };
}


async function fetchOfficialAct(documentId, language = "rus", page = 1) {
  const id = String(documentId).trim();
  if (!/^\d+$/.test(id)) throw new Error("document_id must be numeric");
  const lang = ["rus", "kaz"].includes(language) ? language : "rus";
  const url = `https://zan.gov.kz/api/documents/${id}/${lang}?withHtml=true&page=${page}&r=${Date.now()}`;
  const response = await fetch(url, {
    headers: {
      "accept": "application/json,text/plain,*/*",
      "user-agent": "AI-Lawyer-KZ/0.8 (+legal-research)"
    }
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Official source HTTP ${response.status}`);
  let data;
  try { data = JSON.parse(raw); } catch { data = { raw_text: raw.slice(0, 60000) }; }
  return {
    source: "Эталонный контрольный банк НПА Республики Казахстан",
    source_url: url,
    pdf_url: `https://zan.gov.kz/api/documents/${id}/${lang}/download/pdf`,
    document_id: id,
    language: lang,
    page,
    data
  };
}

async function runMemorySelfTest() {
  try {
    const listed = await memoryRequest({ action: "list_cases", limit: 50 });
    let testCase = Array.isArray(listed?.cases)
      ? listed.cases.find((c) => c?.title === "__system_e2e_test__")
      : null;

    if (!testCase) {
      const created = await memoryRequest({
        action: "create_case",
        title: "__system_e2e_test__",
        objective: "Verify persistent memory write/read path",
        stage: "system",
        summary: "Automated end-to-end memory test record",
        next_step: "none",
        jurisdiction: "KZ"
      });
      testCase = created?.case;
      if (testCase?.id) {
        await memoryRequest({
          action: "update_case",
          case_id: testCase.id,
          status: "system",
          summary: "Automated end-to-end memory test record"
        });
      }
    }

    if (!testCase?.id) throw new Error("Self-test case id missing");

    const marker = `memory-self-test:${new Date().toISOString()}`;
    await memoryRequest({
      action: "add_update",
      case_id: testCase.id,
      update_type: "system_test",
      content: marker,
      source_ref: "railway-startup",
      delta: { marker }
    });

    const loaded = await memoryRequest({ action: "get_case", case_id: testCase.id });
    const ok = Array.isArray(loaded?.updates) && loaded.updates.some((u) => u?.content === marker);
    if (!ok) throw new Error("Self-test write could not be read back");

    console.log("Persistent memory self-test OK", testCase.id);
  } catch (error) {
    console.error("Persistent memory self-test FAILED", error);
  }
}

const textResult = (message, data = {}) => ({
  content: [{ type: "text", text: message }],
  structuredContent: data,
});

const oauthChallenge = () =>
  `Bearer resource_metadata="${MCP_RESOURCE_URL}/.well-known/oauth-protected-resource", error="insufficient_scope", error_description="Link your AI Lawyer account to use saved case memory"`;

const authRequiredResult = () => ({
  content: [{ type: "text", text: "Для сохраненной памяти дела нужно подключить аккаунт AI Юрист Казахстан." }],
  structuredContent: { authentication_required: true },
  _meta: { "mcp/www_authenticate": [oauthChallenge()] },
  isError: true,
});

const memoryFailure = (error, message) =>
  error instanceof AuthRequiredError
    ? authRequiredResult()
    : textResult(message, { error: String(error) });

function createLegalServer(authContext = {}) {
  const memory = (payload) => {
    if (!PUBLIC_OAUTH_ENABLED) return memoryRequest(payload);
    if (!authContext?.token || !authContext?.subject) throw new AuthRequiredError("Authentication required");
    return authenticatedMemoryRequest(payload, authContext);
  };
  const memorySecuritySchemes = PUBLIC_OAUTH_ENABLED
    ? [{ type: "oauth2", scopes: MEMORY_OAUTH_SCOPES }]
    : [{ type: "noauth" }];
  const server = new McpServer({
    name: "ai-lawyer-kazakhstan",
    version: "0.9.0",
  });

  server.registerTool(
    "legal_case_intake",
    {
      annotations: {"readOnlyHint":true,"openWorldHint":false,"destructiveHint":false},
      securitySchemes: [{ type: "noauth" }],
      title: "Разобрать юридическую ситуацию",
      description:
        "Структурирует юридическую ситуацию по праву Республики Казахстан: факты, стороны, даты, суммы, цель, доказательства, пробелы и вопросы для дальнейшего правового анализа. Используй в начале сложного дела.",
      inputSchema: {
        facts: z.string().min(10).describe("Факты дела свободным текстом"),
        objective: z.string().min(3).describe("Какого результата хочет пользователь"),
        stage: z.string().optional().describe("Текущая стадия: досудебная, суд, исполнение и т.п."),
        documents: z.array(z.string()).optional().describe("Какие документы уже есть"),
      },
    },
    async ({ facts, objective, stage, documents = [] }) => {
      const normalized = {
        jurisdiction: "Республика Казахстан",
        objective,
        stage: stage || "не указана",
        supplied_documents: documents,
        factual_record: facts,
        required_analysis: [
          "отделить подтвержденные факты от утверждений",
          "выявить юридически значимые даты и сроки",
          "определить применимые НПА РК и актуальную редакцию",
          "проверить надлежащий орган/суд и процессуальный путь",
          "определить недостающие доказательства",
          "оценить риски и следующий практический шаг",
        ],
      };
      return textResult(
        "Дело структурировано. Используй данные как основу юридического анализа; не выдумывай статьи или факты, которых нет во входных данных.",
        normalized
      );
    }
  );

  server.registerTool(
    "kz_law_research",
    {
      annotations: {"readOnlyHint":true,"openWorldHint":false,"destructiveHint":false},
      securitySchemes: [{ type: "noauth" }],
      title: "Исследовать норму права РК",
      description:
        "Формирует точное задание на проверку законодательства Казахстана. Применяй перед ссылкой на статью закона, срок, полномочие органа или процессуальное правило.",
      inputSchema: {
        legal_issue: z.string().min(5).describe("Конкретный правовой вопрос"),
        known_act: z.string().optional().describe("Предполагаемый НПА, если известен"),
        relevant_date: z.string().optional().describe("Дата события для проверки редакции нормы"),
      },
    },
    async ({ legal_issue, known_act, relevant_date }) => {
      const data = {
        legal_issue,
        known_act: known_act || null,
        relevant_date: relevant_date || "текущая дата, если событие не привязано к прошлой редакции",
        authoritative_sources: [
          "Эталонный контрольный банк НПА / Adilet",
          "официальные сайты государственных органов Республики Казахстан",
          "нормативные постановления Верховного Суда Республики Казахстан",
        ],
        verification_rules: [
          "проверить, действует ли НПА",
          "проверить редакцию на юридически значимую дату",
          "проверить номер и содержание статьи по официальному тексту",
          "отделить норму закона от правового вывода",
          "при неопределенности прямо указать, что требуется дополнительная проверка",
        ],
      };
      return textResult(
        "Сформировано задание на проверку законодательства РК. Перед окончательным выводом используй актуальный официальный источник.",
        data
      );
    }
  );

  server.registerTool(
    "kz_official_act_fetch",
    {
      annotations: {"readOnlyHint":true,"openWorldHint":true,"destructiveHint":false},
      securitySchemes: [{ type: "noauth" }],
      title: "Получить НПА из официального ЭКБ",
      description:
        "Получает документ напрямую из официального Эталонного контрольного банка НПА Республики Казахстан по его числовому идентификатору. Используй для проверки реквизитов, текста и официальной PDF-ссылки, когда document_id известен.",
      inputSchema: {
        document_id: z.string().regex(/^\d+$/).describe("Числовой идентификатор документа в ЭКБ zan.gov.kz"),
        language: z.enum(["rus","kaz"]).optional(),
        page: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ document_id, language = "rus", page = 1 }) => {
      try {
        const data = await fetchOfficialAct(document_id, language, page);
        return textResult("Документ получен из официального ЭКБ. Проверяй юридический вывод по реквизитам и редакции документа, а не только по названию.", data);
      } catch (error) {
        return textResult("Не удалось получить документ из официального ЭКБ.", {
          document_id,
          error: String(error),
          fallback_url: `https://zan.gov.kz/api/documents/${document_id}/${language}/download/pdf`
        });
      }
    }
  );

  server.registerTool(
    "case_strategy",
    {
      annotations: {"readOnlyHint":true,"openWorldHint":false,"destructiveHint":false},
      securitySchemes: [{ type: "noauth" }],
      title: "Построить стратегию по делу",
      description:
        "Формирует каркас процессуальной стратегии по делу в Казахстане: цель, доказательства, слабые места, действия, сроки и альтернативные маршруты.",
      inputSchema: {
        facts: z.string().min(10),
        objective: z.string().min(3),
        evidence: z.array(z.string()).optional(),
        missing_evidence: z.array(z.string()).optional(),
      },
    },
    async ({ facts, objective, evidence = [], missing_evidence = [] }) => {
      const data = {
        objective,
        facts,
        evidence,
        missing_evidence,
        strategy_blocks: [
          "1. Зафиксировать доказанные факты и хронологию.",
          "2. Проверить применимые нормы и процессуальные сроки.",
          "3. Определить надлежащего адресата: контрагент, госорган, нотариус, ЧСИ или суд.",
          "4. Истребовать недостающие документы до необратимого процессуального шага.",
          "5. Сформулировать основную позицию и резервную позицию.",
          "6. Подготовить документ с конкретной просительной частью и приложениями.",
        ],
      };
      return textResult("Каркас стратегии подготовлен.", data);
    }
  );

  if (PUBLIC_OAUTH_ENABLED) {
  server.registerTool(
    "case_memory_create",
    {
      annotations: {"readOnlyHint":false,"openWorldHint":false,"destructiveHint":false},
      securitySchemes: memorySecuritySchemes,
      title: "Создать память дела",
      description:
        "Создает постоянную карточку юридического дела в защищенной базе. Используй, когда пользователь начинает отдельное продолжающееся дело и контекст нужно сохранять между сообщениями.",
      inputSchema: {
        title: z.string().min(2),
        objective: z.string().min(3),
        stage: z.string().optional(),
        summary: z.string().optional(),
        next_step: z.string().optional(),
      },
    },
    async ({ title, objective, stage, summary, next_step }) => {
      try {
        const data = await memory({
          action: "create_case",
          title, objective, stage, summary, next_step, jurisdiction: "KZ",
        });
        return textResult("Постоянная карточка дела создана.", data);
      } catch (error) {
        return memoryFailure(error, "Не удалось создать постоянную память дела.");
      }
    }
  );

  server.registerTool(
    "case_memory_list",
    {
      annotations: {"readOnlyHint":true,"openWorldHint":false,"destructiveHint":false},
      securitySchemes: memorySecuritySchemes,
      title: "Найти сохраненное дело",
      description:
        "Возвращает список последних сохраненных юридических дел пользователя. Используй, когда нужно продолжить ранее начатое дело и case_id неизвестен.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ limit = 20 }) => {
      try {
        const data = await memory({ action: "list_cases", limit });
        return textResult("Сохраненные дела получены.", data);
      } catch (error) {
        return memoryFailure(error, "Не удалось получить список дел.");
      }
    }
  );

  server.registerTool(
    "case_memory_search",
    {
      annotations: {"readOnlyHint":true,"openWorldHint":false,"destructiveHint":false},
      securitySchemes: memorySecuritySchemes,
      title: "Поиск сохраненного дела",
      description:
        "Ищет постоянные карточки дел по названию, цели или сводке. Используй короткую ключевую фразу пользователя, когда он говорит 'дело Цоя', 'по коллектору' и т.п.",
      inputSchema: {
        query: z.string().min(2),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ query, limit = 20 }) => {
      try {
        const data = await memory({ action: "search_cases", query, limit });
        return textResult("Поиск по сохраненным делам выполнен.", data);
      } catch (error) {
        return memoryFailure(error, "Не удалось выполнить поиск по памяти дел.");
      }
    }
  );

  server.registerTool(
    "case_memory_get",
    {
      annotations: {"readOnlyHint":true,"openWorldHint":false,"destructiveHint":false},
      securitySchemes: memorySecuritySchemes,
      title: "Загрузить память дела",
      description:
        "Загружает полную постоянную карточку дела: сводку, факты, версии, события, документы и историю обновлений. Используй перед продолжением ранее начатого сложного дела.",
      inputSchema: {
        case_id: z.string().uuid(),
      },
    },
    async ({ case_id }) => {
      try {
        const data = await memory({ action: "get_case", case_id });
        return textResult("Память дела загружена.", data);
      } catch (error) {
        return memoryFailure(error, "Не удалось загрузить память дела.");
      }
    }
  );

  server.registerTool(
    "case_memory_update",
    {
      annotations: {"readOnlyHint":false,"openWorldHint":false,"destructiveHint":false},
      securitySchemes: memorySecuritySchemes,
      title: "Обновить память юридического дела",
      description:
        "Сохраняет новое существенное обстоятельство, документ, ответ органа или изменение позиции в постоянной истории дела. Не перезаписывает старую версию молча.",
      inputSchema: {
        case_id: z.string().uuid(),
        content: z.string().min(5).describe("Что нового произошло или установлено"),
        update_type: z.string().optional().describe("fact/document/response/strategy/note"),
        source_ref: z.string().optional().describe("Источник или название документа"),
        summary: z.string().optional().describe("Новая актуальная краткая сводка дела"),
        current_strategy: z.string().optional(),
        next_step: z.string().optional(),
      },
    },
    async ({ case_id, content, update_type = "note", source_ref, summary, current_strategy, next_step }) => {
      try {
        const update = await memory({
          action: "add_update",
          case_id,
          update_type,
          content,
          source_ref: source_ref || null,
          delta: {},
        });
        let c = null;
        if (summary !== undefined || current_strategy !== undefined || next_step !== undefined) {
          c = await memory({
            action: "update_case",
            case_id,
            ...(summary !== undefined ? { summary } : {}),
            ...(current_strategy !== undefined ? { current_strategy } : {}),
            ...(next_step !== undefined ? { next_step } : {}),
          });
        }
        return textResult("Память дела обновлена без удаления предыдущей истории.", { update, case: c });
      } catch (error) {
        return memoryFailure(error, "Не удалось обновить постоянную память дела.");
      }
    }
  );

  server.registerTool(
    "case_memory_add_party",
    {
      annotations: {"readOnlyHint":false,"openWorldHint":false,"destructiveHint":false},
      securitySchemes: memorySecuritySchemes,
      title: "Сохранить участника дела",
      description:
        "Сохраняет участника дела и его процессуальную/фактическую роль. Используй для клиента, ответчика, истца, банка, МФО, нотариуса, ЧСИ, госоргана, представителя и иных значимых участников.",
      inputSchema: {
        case_id: z.string().uuid(),
        name: z.string().min(2),
        role: z.string().optional(),
        organization: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    async ({ case_id, name, role, organization, notes }) => {
      try {
        const data = await memory({
          action: "add_party", case_id, name,
          role: role || null,
          organization: organization || null,
          notes: notes || null,
          metadata: {},
        });
        return textResult("Участник сохранен в карточке дела.", data);
      } catch (error) {
        return memoryFailure(error, "Не удалось сохранить участника дела.");
      }
    }
  );

  server.registerTool(
    "case_memory_add_deadline",
    {
      annotations: {"readOnlyHint":false,"openWorldHint":false,"destructiveHint":false},
      securitySchemes: memorySecuritySchemes,
      title: "Сохранить срок по делу",
      description:
        "Сохраняет процессуальный или практический срок с основанием и источником. Если срок не проверен по актуальной норме, пометь статусом uncertain и не выдавай его как достоверный.",
      inputSchema: {
        case_id: z.string().uuid(),
        title: z.string().min(3),
        due_at: z.string().optional().describe("ISO дата/время, если установлено"),
        deadline_type: z.string().optional(),
        legal_basis: z.string().optional(),
        source_ref: z.string().optional(),
        status: z.enum(["open","completed","cancelled","uncertain"]).optional(),
        notes: z.string().optional(),
      },
    },
    async ({ case_id, title, due_at, deadline_type, legal_basis, source_ref, status = "open", notes }) => {
      try {
        const data = await memory({
          action: "add_deadline", case_id, title,
          due_at: due_at || null,
          deadline_type: deadline_type || null,
          legal_basis: legal_basis || null,
          source_ref: source_ref || null,
          status,
          notes: notes || null,
        });
        return textResult("Срок сохранен в карточке дела.", data);
      } catch (error) {
        return memoryFailure(error, "Не удалось сохранить срок.");
      }
    }
  );

  server.registerTool(
    "case_memory_update_deadline",
    {
      annotations: {"readOnlyHint":false,"openWorldHint":false,"destructiveHint":false,"idempotentHint":true},
      securitySchemes: memorySecuritySchemes,
      title: "Обновить срок по делу",
      description:
        "Обновляет ранее сохраненный срок: дату, статус, основание или примечание. Используй, когда срок уточнен, исполнен, отменен или оказался предварительным.",
      inputSchema: {
        case_id: z.string().uuid(),
        deadline_id: z.number().int().positive(),
        title: z.string().optional(),
        due_at: z.string().nullable().optional(),
        deadline_type: z.string().optional(),
        legal_basis: z.string().optional(),
        source_ref: z.string().optional(),
        status: z.enum(["open","completed","cancelled","uncertain"]).optional(),
        notes: z.string().optional(),
      },
    },
    async ({ case_id, deadline_id, ...patch }) => {
      try {
        const data = await memory({
          action: "update_deadline",
          case_id,
          deadline_id,
          ...patch,
        });
        return textResult("Срок обновлен.", data);
      } catch (error) {
        return memoryFailure(error, "Не удалось обновить срок.");
      }
    }
  );

  server.registerTool(
    "case_memory_add_fact",
    {
      annotations: {"readOnlyHint":false,"openWorldHint":false,"destructiveHint":false},
      securitySchemes: memorySecuritySchemes,
      title: "Сохранить факт или версию по делу",
      description:
        "Сохраняет отдельный подтвержденный факт, утверждение стороны, гипотезу, недостающее доказательство или риск с источником и уверенностью.",
      inputSchema: {
        case_id: z.string().uuid(),
        category: z.enum(["confirmed_fact","party_claim","hypothesis","missing_evidence","risk"]),
        statement: z.string().min(3),
        source_ref: z.string().optional(),
        event_date: z.string().optional(),
        confidence: z.number().int().min(0).max(100).optional(),
      },
    },
    async ({ case_id, category, statement, source_ref, event_date, confidence }) => {
      try {
        const data = await memory({
          action: "add_fact", case_id, category, statement,
          source_ref: source_ref || null,
          event_date: event_date || null,
          confidence: confidence ?? null,
        });
        return textResult("Элемент дела сохранен в постоянной памяти.", data);
      } catch (error) {
        return memoryFailure(error, "Не удалось сохранить элемент дела.");
      }
    }
  );

  server.registerTool(
    "case_memory_add_event",
    {
      annotations: {"readOnlyHint":false,"openWorldHint":false,"destructiveHint":false},
      securitySchemes: memorySecuritySchemes,
      title: "Добавить событие в хронологию",
      description:
        "Сохраняет юридически значимое событие в постоянной хронологии дела.",
      inputSchema: {
        case_id: z.string().uuid(),
        description: z.string().min(3),
        event_date: z.string().optional(),
        event_type: z.string().optional(),
        source_ref: z.string().optional(),
      },
    },
    async ({ case_id, description, event_date, event_type, source_ref }) => {
      try {
        const data = await memory({
          action: "add_event", case_id, description,
          event_date: event_date || null,
          event_type: event_type || null,
          source_ref: source_ref || null,
        });
        return textResult("Событие добавлено в хронологию дела.", data);
      } catch (error) {
        return memoryFailure(error, "Не удалось сохранить событие.");
      }
    }
  );

  server.registerTool(
    "case_memory_add_document",
    {
      annotations: {"readOnlyHint":false,"openWorldHint":false,"destructiveHint":false},
      securitySchemes: memorySecuritySchemes,
      title: "Сохранить документ в карточке дела",
      description:
        "Сохраняет в постоянной памяти сведения о документе и его юридически значимую сводку. Используй после анализа нового договора, ответа, судебного акта, постановления, чека, доверенности и т.п.",
      inputSchema: {
        case_id: z.string().uuid(),
        filename: z.string().optional(),
        document_type: z.string().optional(),
        document_date: z.string().optional(),
        source_party: z.string().optional(),
        summary: z.string().min(5).describe("Краткая обезличенная юридически значимая сводка. Не включай государственные идентификаторы, данные банковских карт, пароли, API-ключи или MFA/OTP-коды."),
        sha256: z.string().optional(),
        storage_path: z.string().optional(),
        extracted_metadata: z.record(z.any()).optional(),
      },
    },
    async ({ case_id, filename, document_type, document_date, source_party, summary, sha256, storage_path, extracted_metadata = {} }) => {
      try {
        const data = await memory({
          action: "add_document",
          case_id,
          filename: filename || null,
          document_type: document_type || null,
          document_date: document_date || null,
          source_party: source_party || null,
          summary,
          sha256: sha256 || null,
          storage_path: storage_path || null,
          extracted_metadata,
        });
        return textResult("Документ сохранен в карточке дела.", data);
      } catch (error) {
        return memoryFailure(error, "Не удалось сохранить документ в карточке дела.");
      }
    }
  );

  server.registerTool(
    "case_memory_delete",
    {
      annotations: {"readOnlyHint":false,"openWorldHint":false,"destructiveHint":true},
      securitySchemes: memorySecuritySchemes,
      title: "Удалить сохраненное дело",
      description:
        "Безвозвратно удаляет карточку дела и связанные факты, события, документы и обновления. Используй только по прямому запросу пользователя на удаление конкретного дела и только после явного подтверждения.",
      inputSchema: {
        case_id: z.string().uuid(),
        confirm: z.literal(true).describe("Должно быть true только после явного подтверждения пользователя"),
      },
    },
    async ({ case_id, confirm }) => {
      try {
        const data = await memory({ action: "delete_case", case_id, confirm });
        return textResult("Дело и связанные данные удалены.", data);
      } catch (error) {
        return memoryFailure(error, "Не удалось удалить дело.");
      }
    }
  );

  }

  server.registerTool(
    "contradiction_audit",
    {
      annotations: {"readOnlyHint":true,"openWorldHint":false,"destructiveHint":false},
      securitySchemes: [{ type: "noauth" }],
      title: "Проверить дело на противоречия",
      description:
        "Проводит повторную проверку материалов как юрист-ревизор: ищет расхождения в датах, суммах, подписях, полномочиях, платежах, версиях сторон, приложениях, уведомлениях и последовательности событий.",
      inputSchema: {
        materials: z.string().min(20).describe("Сводка дела, документы или позиции сторон"),
        focus: z.string().optional().describe("На чем особенно сосредоточиться"),
      },
    },
    async ({ materials, focus }) => {
      const data = {
        materials,
        focus: focus || "полная проверка",
        audit_points: [
          "даты документа, подписания, регистрации, платежа, передачи и ответа",
          "суммы и арифметика между договорами, чеками, платежами и расчетами",
          "кто именно подписал/направил/получил документ и имел ли полномочия",
          "совпадают ли утверждения стороны с ее же предыдущими письмами и документами",
          "есть ли ссылка на документ, которого фактически нет в материалах",
          "есть ли событие, которое юридически невозможно без предыдущего обязательного шага",
          "есть ли изменение версии событий без объяснения",
          "какое противоречие уже доказано, а какое требует дополнительного доказательства",
        ],
        output_rule:
          "Для каждого найденного расхождения укажи: источник A, источник B, суть противоречия, юридическое значение, что нужно проверить и как это можно использовать процессуально.",
      };
      return textResult("Чек-лист ревизии подготовлен. Ищи противоречия, а не подтверждение заранее выбранной версии пользователя.", data);
    }
  );

  server.registerTool(
    "second_lawyer_review",
    {
      annotations: {"readOnlyHint":true,"openWorldHint":false,"destructiveHint":false},
      securitySchemes: [{ type: "noauth" }],
      title: "Второй юрист по делу",
      description:
        "Независимо перепроверяет уже сформированную позицию. Не соглашается автоматически с пользователем или предыдущим анализом; ищет слабые места, альтернативное объяснение, недоказанные переходы и сильнейшие контраргументы другой стороны.",
      inputSchema: {
        position: z.string().min(20).describe("Текущая позиция/вывод по делу"),
        objective: z.string().min(3).describe("Какого результата добивается пользователь"),
        evidence: z.array(z.string()).optional().describe("Ключевые доказательства"),
        opposing_position: z.string().optional().describe("Позиция другой стороны, если известна"),
      },
    },
    async ({ position, objective, evidence = [], opposing_position }) => {
      const data = {
        objective,
        position,
        evidence,
        opposing_position: opposing_position || null,
        review_sequence: [
          "1. Что в позиции подтверждено надежными доказательствами.",
          "2. Что является только предположением или интерпретацией.",
          "3. Какие причинно-следственные переходы не доказаны.",
          "4. Какую альтернативную фактическую версию может предложить другая сторона.",
          "5. Какие нормы/сроки/полномочия требуется перепроверить по официальному источнику.",
          "6. Какие аргументы позиции самые сильные и какие самые уязвимые.",
          "7. Какого одного-двух доказательств не хватает больше всего.",
          "8. Как скорректировать стратегию без преувеличения доказательств.",
        ],
        behavioral_rules: [
          "не подгонять вывод под желаемый результат",
          "не превращать гипотезу в факт",
          "при нехватке данных прямо говорить, что вывод предварительный",
          "искать не только нарушение, но и невиновное/альтернативное объяснение",
        ],
      };
      return textResult("Независимая перепроверка позиции подготовлена. Работай как второй юрист, а не как подтверждающий собеседник.", data);
    }
  );


  server.registerTool(
    "analyze_legal_document",
    {
      annotations: {"readOnlyHint":true,"openWorldHint":false,"destructiveHint":false},
      securitySchemes: [{ type: "noauth" }],
      title: "Проанализировать юридический документ",
      description:
        "Проводит юридический разбор текста документа по праву Республики Казахстан: определяет вид документа, стороны, даты, суммы, требования, ссылки на нормы, подписи/полномочия, приложения, пробелы, противоречия и процессуальное значение. Используй, когда пользователь загрузил или процитировал документ.",
      inputSchema: {
        document_text: z.string().min(20).describe("Обезличенный текст документа или извлеченное содержимое. Не передавай ИИН, номера удостоверений/паспортов, данные банковских карт, пароли, API-ключи, MFA/OTP-коды и иные учетные секреты."),
        document_name: z.string().optional().describe("Название/имя файла"),
        known_case_summary: z.string().optional().describe("Краткая сводка дела для сравнения с документом"),
        user_question: z.string().optional().describe("Что именно пользователь хочет проверить в документе"),
      },
    },
    async ({ document_text, document_name, known_case_summary, user_question }) => {
      const data = {
        document_name: document_name || null,
        user_question: user_question || null,
        known_case_summary: known_case_summary || null,
        analysis_schema: {
          document_type: "Что это за документ и какую юридическую функцию он выполняет.",
          parties_and_roles: "Кто составил, подписал, получил, упомянут и в какой роли.",
          key_dates: "Дата документа, события, подписания, отправки, получения, регистрации, оплаты и иные значимые даты.",
          amounts_and_calculations: "Все суммы, проценты, платежи, остатки и арифметические расхождения.",
          claims_and_requests: "Что утверждается, признается, отрицается и что просит автор.",
          legal_references: "Какие нормы указаны и какие из них требуется проверить по официальному источнику.",
          authority_and_signatures: "Подписи, полномочия, доверенности, ЭЦП, SMS/OTP и иные признаки авторизации.",
          annexes_and_missing_materials: "Указанные приложения и документы, которых фактически нет.",
          contradictions: "Внутренние противоречия и расхождения с известной сводкой дела.",
          evidentiary_value: "Что документ реально доказывает, а чего не доказывает.",
          procedural_effect: "Как документ влияет на срок, стадию, компетенцию, обязанность ответить или дальнейший маршрут.",
          next_step: "Какое одно практическое действие имеет наибольший смысл после анализа."
        },
        rules: [
          "не считать утверждение автора документа доказанным фактом автоматически",
          "не считать ссылку на приложение доказательством существования приложения",
          "не считать подпись/реквизит действительным без проверки, если есть признаки противоречия",
          "отдельно отмечать, что установлено из текста, а что требует внешней проверки",
          "сравнивать документ с известными фактами дела, если сводка передана"
        ],
        document_text
      };
      return textResult("Схема глубокого анализа документа подготовлена. Проведи разбор по всем полям и свяжи выводы с контекстом дела.", data);
    }
  );

  server.registerTool(
    "compare_case_documents",
    {
      annotations: {"readOnlyHint":true,"openWorldHint":false,"destructiveHint":false},
      securitySchemes: [{ type: "noauth" }],
      title: "Сравнить документы по делу",
      description:
        "Сопоставляет два документа или две версии позиции по одному делу и выявляет изменения в датах, суммах, фактах, правовом основании, требованиях, подписях, приложениях и версии событий.",
      inputSchema: {
        document_a: z.string().min(20).describe("Обезличенный текст первого документа или его существенное содержание; исключи государственные идентификаторы и учетные секреты."),
        document_b: z.string().min(20).describe("Обезличенный текст второго документа или его существенное содержание; исключи государственные идентификаторы и учетные секреты."),
        comparison_goal: z.string().optional().describe("Что особенно важно сопоставить"),
      },
    },
    async ({ document_a, document_b, comparison_goal }) => {
      const data = {
        comparison_goal: comparison_goal || "полное сопоставление",
        compare_by: [
          "даты и последовательность событий",
          "суммы, платежи и расчеты",
          "стороны, роли и полномочия",
          "описание фактов и причины событий",
          "признанные и отрицаемые обстоятельства",
          "правовые основания и ссылки на НПА",
          "требования/просительная часть",
          "подписи, реквизиты и способы авторизации",
          "приложения и упомянутые первичные документы",
          "изменение позиции между версиями"
        ],
        output_rule:
          "Верни различия в формате: пункт → документ A → документ B → расхождение → юридическое значение → что проверить/истребовать.",
        document_a,
        document_b
      };
      return textResult("Сопоставление документов подготовлено. Не ограничивайся текстовыми различиями — оцени их юридическое значение.", data);
    }
  );

  server.registerTool(
    "draft_legal_document",
    {
      annotations: {"readOnlyHint":true,"openWorldHint":false,"destructiveHint":false},
      securitySchemes: [{ type: "noauth" }],
      title: "Подготовить юридический документ РК",
      description:
        "Создает структуру юридического документа по праву Казахстана. Используй для жалобы, заявления, иска, ходатайства, запроса, возражения и претензии.",
      inputSchema: {
        document_type: z.string().min(3).describe("Тип документа"),
        addressee: z.string().min(2).describe("Кому адресуется"),
        applicant: z.string().min(2).describe("Заявитель"),
        facts: z.string().min(10).describe("Фактические обстоятельства без государственных идентификаторов и учетных секретов"),
        requests: z.array(z.string()).min(1).describe("Что просим"),
        attachments: z.array(z.string()).optional(),
      },
    },
    async ({ document_type, addressee, applicant, facts, requests, attachments = [] }) => {
      const data = {
        document_type,
        addressee,
        applicant,
        sections: [
          "Шапка: адресат и данные заявителя",
          "Наименование документа",
          "Краткая хронология фактов",
          "Правовое обоснование только после проверки актуальных норм",
          "Противоречия и доказательства",
          "Просительная часть",
          "Приложения",
          "Дата и подпись",
        ],
        facts,
        requests,
        attachments,
        drafting_rules: [
          "не выдумывать реквизиты и факты",
          "не указывать непроверенные номера статей как достоверные",
          "просительная часть должна быть конкретной и исполнимой",
          "стиль документа должен соответствовать адресату",
        ],
      };
      return textResult("Структура документа подготовлена. Сформируй полный текст на основании этих данных.", data);
    }
  );

  return server;
}

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);


  if (req.method === "GET" && url.pathname === "/.well-known/openai-apps-challenge") {
    if (!OPENAI_APPS_CHALLENGE_TOKEN) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not configured");
      return;
    }
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end(OPENAI_APPS_CHALLENGE_TOKEN);
    return;
  }

  if (PUBLIC_OAUTH_ENABLED && req.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" });
    res.end(JSON.stringify({
      resource: MCP_RESOURCE_URL,
      authorization_servers: [OAUTH_ISSUER_URL],
      scopes_supported: MEMORY_OAUTH_SCOPES,
      resource_documentation: `${MCP_RESOURCE_URL}/support`,
      resource_policy_uri: `${MCP_RESOURCE_URL}/privacy`,
      resource_tos_uri: `${MCP_RESOURCE_URL}/terms`
    }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/oauth/consent") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; connect-src 'self' https://*.supabase.co; style-src 'unsafe-inline'; img-src 'self' data: https:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    });
    res.end(`<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Юрист Казахстан — доступ</title>
<style>
body{font-family:system-ui,sans-serif;background:#f5f6f8;color:#171717;margin:0}
main{max-width:520px;margin:7vh auto;background:#fff;padding:28px;border-radius:18px;box-shadow:0 8px 30px #0001}
h1{font-size:24px;margin-top:0}.muted{color:#666;font-size:14px}
label{display:block;margin:14px 0 6px}input{width:100%;box-sizing:border-box;padding:11px;border:1px solid #ccc;border-radius:10px}
.row{display:flex;gap:10px;margin-top:16px}button{padding:11px 15px;border:0;border-radius:10px;cursor:pointer}
.primary{background:#111;color:white}.secondary{background:#eceef2}.danger{background:#fee2e2}
#consent,#message{display:none}.scope{padding:10px;background:#f5f6f8;border-radius:10px;margin:12px 0}
</style></head>
<body><main>
<h1>AI Юрист Казахстан</h1>
<p class="muted">Подключение памяти юридических дел к вашему AI-агенту.</p>
<div id="message"></div>
<section id="login">
<label>Email</label><input id="email" type="email" autocomplete="email">
<label>Пароль</label><input id="password" type="password" autocomplete="current-password">
<div class="row"><button class="primary" id="signin">Войти</button><button class="secondary" id="signup">Создать аккаунт</button></div>
<p class="muted">Доступ к сохраненным делам изолирован по аккаунту. Пароль обрабатывается Supabase Auth и не передается MCP-инструментам.</p>
</section>
<section id="consent">
<h2>Разрешить доступ?</h2>
<p id="client"></p><div class="scope" id="scope"></div>
<p class="muted">Агент сможет читать и изменять только юридические дела этого аккаунта в пределах функций AI Юрист Казахстан.</p>
<div class="row"><button class="primary" id="approve">Разрешить</button><button class="danger" id="deny">Отклонить</button></div>
</section>
<script type="module">
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
const SUPABASE_URL=${JSON.stringify(SUPABASE_URL)};
const SUPABASE_KEY=${JSON.stringify(SUPABASE_PUBLISHABLE_KEY || "")};
const supabase=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const qs=new URLSearchParams(location.search);
const authorizationId=qs.get("authorization_id");
const login=document.getElementById("login"),consent=document.getElementById("consent"),message=document.getElementById("message");
function showMessage(text,isError=false){message.style.display="block";message.textContent=text;message.style.color=isError?"#991b1b":"#166534";}
async function loadConsent(){
  if(!authorizationId){showMessage("Отсутствует authorization_id.",true);return;}
  const {data:{session}}=await supabase.auth.getSession();
  if(!session){login.style.display="block";consent.style.display="none";return;}
  const {data,error}=await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if(error){showMessage(error.message||"Не удалось получить параметры доступа.",true);return;}
  if(data && !("authorization_id" in data) && data.redirect_url){location.assign(data.redirect_url);return;}
  login.style.display="none";consent.style.display="block";
  const clientName=data?.client?.name||data?.client_name||"AI-клиент";
  const clientUri=data?.client?.uri||data?.client?.website_uri||"";
  document.getElementById("client").textContent="Запрашивает: "+clientName+(clientUri?" ("+clientUri+")":"");
  const scopes=Array.isArray(data?.scopes)?data.scopes.join(", "):(data?.scope||"email");
  document.getElementById("scope").textContent="Разрешение: "+scopes;
}
document.getElementById("signin").onclick=async()=>{
  const email=document.getElementById("email").value.trim(),password=document.getElementById("password").value;
  const {error}=await supabase.auth.signInWithPassword({email,password});
  if(error){showMessage(error.message,true);return;} await loadConsent();
};
document.getElementById("signup").onclick=async()=>{
  const email=document.getElementById("email").value.trim(),password=document.getElementById("password").value;
  const {data,error}=await supabase.auth.signUp({email,password});
  if(error){showMessage(error.message,true);return;}
  if(!data.session){showMessage("Аккаунт создан. Подтвердите email, затем вернитесь на эту страницу.");return;}
  await loadConsent();
};
document.getElementById("approve").onclick=async()=>{
  const {data,error}=await supabase.auth.oauth.approveAuthorization(authorizationId);
  if(error){showMessage(error.message,true);return;} if(data?.redirect_url) location.assign(data.redirect_url);
};
document.getElementById("deny").onclick=async()=>{
  const {data,error}=await supabase.auth.oauth.denyAuthorization(authorizationId);
  if(error){showMessage(error.message,true);return;} if(data?.redirect_url) location.assign(data.redirect_url);
};
await loadConsent();
</script></main></body></html>`);
    return;
  }

  if (req.method === "GET" && url.pathname === "/support") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>AI Юрист Казахстан — Поддержка</title></head><body style="font-family:system-ui;max-width:820px;margin:40px auto;padding:0 20px;line-height:1.55"><h1>Поддержка AI Юрист Казахстан</h1><p>По вопросам подключения, доступа к сохраненным делам, удаления данных и технических ошибок напишите на <a href="mailto:arrestofnet@gmail.com">arrestofnet@gmail.com</a> или используйте <a href="https://github.com/arrestofnet-hub/ai-lawyer/issues">GitHub Issues</a>.</p><p>Не публикуйте в открытом issue тексты договоров, удостоверения личности, банковские реквизиты и другие конфиденциальные материалы.</p></body></html>`);
    return;
  }

  if (req.method === "GET" && url.pathname === "/privacy") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>AI Юрист Казахстан — Политика конфиденциальности</title></head><body style="font-family:system-ui;max-width:820px;margin:40px auto;padding:0 20px;line-height:1.55"><h1>Политика конфиденциальности</h1><p>AI Юрист Казахстан обрабатывает только данные, необходимые для функций, которые запрашивает пользователь.</p><h2>Категории данных</h2><p>Могут обрабатываться: описание юридической ситуации; участники, даты, суммы и хронология; содержание и метаданные переданных документов; сохраненная карточка дела; технические данные аутентификации и идентификатор аккаунта. Сервис не должен запрашивать сведения, не относящиеся к задаче.</p><h2>Цели</h2><p>Данные используются для юридического анализа по праву Республики Казахстан, ведения памяти дела, поиска противоречий, подготовки стратегии и проектов документов, а также для безопасности и работоспособности сервиса.</p><h2>Получатели и инфраструктура</h2><p>Структурированная память хранится в Supabase с разграничением доступа по аккаунтам; серверная часть работает на выделенном VPS, доступном через домены ailawyer.kz и mcp.ailawyer.kz. Данные передаются поставщикам инфраструктуры только в объеме, необходимом для работы сервиса. Пользовательские материалы не продаются рекламодателям.</p><h2>Срок хранения</h2><p>Сохраненная память дела хранится, пока пользователь не удалит конкретное дело или пока аккаунт/сервис не будет закрыт. Технические журналы могут храниться ограниченный период, необходимый для диагностики, безопасности и предотвращения злоупотреблений.</p><h2>Контроль пользователя</h2><p>Пользователь может просматривать сохраненные дела, исправлять их через обновления и удалить конкретное дело по явному запросу. Удаление карточки включает связанные структурированные факты, события, сроки, документы и историю обновлений этой карточки.</p><h2>Безопасность</h2><p>В публичном режиме доступ к памяти дела требует OAuth-аутентификации; доступ к строкам базы ограничивается политиками Row Level Security по идентификатору пользователя.</p><h2>Ограничение</h2><p>AI Юрист Казахстан не является государственным органом, судом, адвокатом или нотариусом и не заменяет индивидуальную профессиональную помощь в ситуациях, где она обязательна.</p><p>Версия политики: 6 октября 2026.</p></body></html>`);
    return;
  }

  if (req.method === "GET" && url.pathname === "/terms") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>AI Юрист Казахстан — Условия использования</title></head><body style="font-family:system-ui;max-width:820px;margin:40px auto;padding:0 20px;line-height:1.55"><h1>Условия использования</h1><p>AI Юрист Казахстан предоставляет инструменты для анализа юридических ситуаций по праву Республики Казахстан, организации материалов дела и подготовки проектов документов.</p><h2>Проверка информации</h2><p>Пользователь должен проверять юридически значимые выводы, актуальность законодательства, реквизиты, сроки и фактические обстоятельства перед подачей документов или совершением действий.</p><h2>Ответственность пользователя</h2><p>Пользователь отвечает за точность переданных фактов, законность использования документов и окончательное решение о совершении юридических действий.</p><h2>Недопустимое использование</h2><p>Нельзя использовать сервис для подделки документов, введения суда или государственного органа в заблуждение, незаконного доступа к данным или иных противоправных действий.</p><h2>Изменения</h2><p>Функциональность и условия могут изменяться в ходе тестирования и развития продукта.</p><p>Версия условий: 6 октября 2026.</p></body></html>`);
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Юрист Казахстан</title></head><body style="font-family:system-ui;max-width:900px;margin:48px auto;padding:0 20px;line-height:1.6;color:#171717"><h1>AI Юрист Казахстан</h1><p>AI-помощник для работы с юридическими вопросами по законодательству Республики Казахстан.</p><p>Сервис помогает структурировать факты и хронологию, анализировать и сопоставлять документы, выявлять противоречия и пробелы в доказательствах, вести сохранённый контекст дела и готовить проекты юридических документов.</p><p><strong>Важно:</strong> сервис не является государственным органом, судом, адвокатом или нотариусом и не заменяет обязательную профессиональную помощь. Юридически значимые выводы, актуальность норм, сроки и реквизиты следует проверять перед совершением действий.</p><p><a href="/privacy">Конфиденциальность</a> · <a href="/terms">Условия</a> · <a href="/support">Поддержка</a></p></body></html>`);
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      ok: true,
      service: "AI Юрист Казахстан",
      version: "0.9.0",
      mcp: MCP_PATH,
      git_commit: process.env.RAILWAY_GIT_COMMIT_SHA || null
    }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/ready") {
    try {
      const memoryStatus = await memoryRequest({ action: "list_cases", limit: 1 });
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        ok: true,
        service: "AI Юрист Казахстан",
        version: "0.9.0",
        mcp: MCP_PATH,
        persistent_memory: "ok",
        remembered_cases: Array.isArray(memoryStatus?.cases) ? memoryStatus.cases.length : null,
        git_commit: process.env.RAILWAY_GIT_COMMIT_SHA || null
      }));
    } catch (error) {
      res.writeHead(503, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        ok: false,
        service: "AI Юрист Казахстан",
        version: "0.9.0",
        persistent_memory: "error",
        error: String(error)
      }));
    }
    return;
  }

  if (req.method === "OPTIONS" && url.pathname === MCP_PATH) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id, authorization",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  const methods = new Set(["POST", "GET", "DELETE"]);
  if (url.pathname === MCP_PATH && req.method && methods.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    let authContext = {};
    const authorization = req.headers.authorization;
    if (authorization?.startsWith("Bearer ")) {
      const token = authorization.slice(7).trim();
      const verified = await verifySupabaseUserToken(token);
      if (verified) authContext = verified;
    }

    const server = createLegalServer(authContext);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("MCP request failed:", error);
      if (!res.headersSent) res.writeHead(500).end("Internal server error");
    }
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`AI Юрист Казахстан MCP listening on port ${PORT}${MCP_PATH}`);
  runMemorySelfTest();
});
