import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT ?? 8787);
const MCP_PATH = "/mcp";

const textResult = (message, data = {}) => ({
  content: [{ type: "text", text: message }],
  structuredContent: data,
});

function createLegalServer() {
  const server = new McpServer({
    name: "ai-lawyer-kazakhstan",
    version: "0.1.0",
  });

  server.registerTool(
    "legal_case_intake",
    {
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
    "case_strategy",
    {
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

  server.registerTool(
    "draft_legal_document",
    {
      title: "Подготовить юридический документ РК",
      description:
        "Создает структуру юридического документа по праву Казахстана. Используй для жалобы, заявления, иска, ходатайства, запроса, возражения и претензии.",
      inputSchema: {
        document_type: z.string().min(3).describe("Тип документа"),
        addressee: z.string().min(2).describe("Кому адресуется"),
        applicant: z.string().min(2).describe("Заявитель"),
        facts: z.string().min(10).describe("Фактические обстоятельства"),
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

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      ok: true,
      service: "AI Юрист Казахстан",
      version: "0.1.0",
      mcp: MCP_PATH
    }));
    return;
  }

  if (req.method === "OPTIONS" && url.pathname === MCP_PATH) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  const methods = new Set(["POST", "GET", "DELETE"]);
  if (url.pathname === MCP_PATH && req.method && methods.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const server = createLegalServer();
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
});
