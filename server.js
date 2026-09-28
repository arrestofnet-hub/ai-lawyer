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
    version: "0.3.0",
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
    "case_memory_update",
    {
      title: "Обновить память юридического дела",
      description:
        "Преобразует новую информацию по делу в структурированную память: подтвержденные факты, утверждения сторон, гипотезы, хронология, суммы, документы, противоречия, пробелы, сроки, стратегия и следующий шаг. Используй после существенного нового документа, ответа органа, показаний или изменения позиции.",
      inputSchema: {
        new_information: z.string().min(10).describe("Новая информация, документ или обстоятельство"),
        current_goal: z.string().min(3).describe("Текущая цель пользователя по делу"),
        prior_summary: z.string().optional().describe("Имеющаяся краткая память/сводка дела"),
        case_id: z.string().optional().describe("Идентификатор дела, если уже есть"),
      },
    },
    async ({ new_information, current_goal, prior_summary, case_id }) => {
      const data = {
        case_id: case_id || null,
        current_goal,
        prior_summary: prior_summary || null,
        new_information,
        memory_schema: {
          confirmed_facts: "Только то, что подтверждено документом, записью, ответом органа или иным доказательством.",
          party_claims: "Что утверждает каждая сторона, отдельно от доказанных фактов.",
          hypotheses: "Рабочие версии, которые нельзя выдавать за установленный факт.",
          chronology: "Юридически значимые события по датам.",
          amounts: "Суммы, платежи, расчеты и расхождения.",
          documents: "Документы, их дата, автор, реквизиты и доказательственное значение.",
          contradictions: "Несостыковки между документами, датами, суммами, версиями и поведением сторон.",
          missing_evidence: "Чего не хватает и каким запросом/ходатайством это получить.",
          procedure: "Стадия, сроки, компетентный орган/суд и уже совершенные действия.",
          strategy: "Основная позиция, резервная позиция и риски.",
          next_step: "Один наиболее практичный следующий шаг.",
        },
        rules: [
          "не перезаписывать ранее установленный факт новой неподтвержденной версией",
          "при конфликте новых и старых данных фиксировать противоречие",
          "всегда помечать источник ключевого факта",
          "не смешивать юридический вывод с фактическим обстоятельством",
        ],
      };
      return textResult("Сформирована схема обновления памяти дела. Обнови карточку дела без потери ранее подтвержденных обстоятельств.", data);
    }
  );

  server.registerTool(
    "contradiction_audit",
    {
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
      title: "Проанализировать юридический документ",
      description:
        "Проводит юридический разбор текста документа по праву Республики Казахстан: определяет вид документа, стороны, даты, суммы, требования, ссылки на нормы, подписи/полномочия, приложения, пробелы, противоречия и процессуальное значение. Используй, когда пользователь загрузил или процитировал документ.",
      inputSchema: {
        document_text: z.string().min(20).describe("Текст документа или извлеченное содержимое"),
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
      title: "Сравнить документы по делу",
      description:
        "Сопоставляет два документа или две версии позиции по одному делу и выявляет изменения в датах, суммах, фактах, правовом основании, требованиях, подписях, приложениях и версии событий.",
      inputSchema: {
        document_a: z.string().min(20).describe("Первый документ или его существенное содержание"),
        document_b: z.string().min(20).describe("Второй документ или его существенное содержание"),
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
      version: "0.3.0",
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
