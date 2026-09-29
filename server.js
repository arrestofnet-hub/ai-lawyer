import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT ?? 8787);
const MCP_PATH = "/mcp";
const MEMORY_URL = process.env.SUPABASE_MEMORY_URL;
const MEMORY_API_KEY = process.env.SUPABASE_MEMORY_API_KEY;

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

function createLegalServer() {
  const server = new McpServer({
    name: "ai-lawyer-kazakhstan",
    version: "0.5.0",
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
    "case_memory_create",
    {
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
        const data = await memoryRequest({
          action: "create_case",
          title, objective, stage, summary, next_step, jurisdiction: "KZ",
        });
        return textResult("Постоянная карточка дела создана.", data);
      } catch (error) {
        return textResult("Не удалось создать постоянную память дела.", { error: String(error) });
      }
    }
  );

  server.registerTool(
    "case_memory_list",
    {
      title: "Найти сохраненное дело",
      description:
        "Возвращает список последних сохраненных юридических дел пользователя. Используй, когда нужно продолжить ранее начатое дело и case_id неизвестен.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ limit = 20 }) => {
      try {
        const data = await memoryRequest({ action: "list_cases", limit });
        return textResult("Сохраненные дела получены.", data);
      } catch (error) {
        return textResult("Не удалось получить список дел.", { error: String(error) });
      }
    }
  );

  server.registerTool(
    "case_memory_get",
    {
      title: "Загрузить память дела",
      description:
        "Загружает полную постоянную карточку дела: сводку, факты, версии, события, документы и историю обновлений. Используй перед продолжением ранее начатого сложного дела.",
      inputSchema: {
        case_id: z.string().uuid(),
      },
    },
    async ({ case_id }) => {
      try {
        const data = await memoryRequest({ action: "get_case", case_id });
        return textResult("Память дела загружена.", data);
      } catch (error) {
        return textResult("Не удалось загрузить память дела.", { error: String(error) });
      }
    }
  );

  server.registerTool(
    "case_memory_update",
    {
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
        const update = await memoryRequest({
          action: "add_update",
          case_id,
          update_type,
          content,
          source_ref: source_ref || null,
          delta: {},
        });
        let c = null;
        if (summary !== undefined || current_strategy !== undefined || next_step !== undefined) {
          c = await memoryRequest({
            action: "update_case",
            case_id,
            ...(summary !== undefined ? { summary } : {}),
            ...(current_strategy !== undefined ? { current_strategy } : {}),
            ...(next_step !== undefined ? { next_step } : {}),
          });
        }
        return textResult("Память дела обновлена без удаления предыдущей истории.", { update, case: c });
      } catch (error) {
        return textResult("Не удалось обновить постоянную память дела.", { error: String(error) });
      }
    }
  );

  server.registerTool(
    "case_memory_add_fact",
    {
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
        const data = await memoryRequest({
          action: "add_fact", case_id, category, statement,
          source_ref: source_ref || null,
          event_date: event_date || null,
          confidence: confidence ?? null,
        });
        return textResult("Элемент дела сохранен в постоянной памяти.", data);
      } catch (error) {
        return textResult("Не удалось сохранить элемент дела.", { error: String(error) });
      }
    }
  );

  server.registerTool(
    "case_memory_add_event",
    {
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
        const data = await memoryRequest({
          action: "add_event", case_id, description,
          event_date: event_date || null,
          event_type: event_type || null,
          source_ref: source_ref || null,
        });
        return textResult("Событие добавлено в хронологию дела.", data);
      } catch (error) {
        return textResult("Не удалось сохранить событие.", { error: String(error) });
      }
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


  if (req.method === "GET" && url.pathname === "/privacy") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>AI Юрист Казахстан — Политика конфиденциальности</title></head><body style="font-family:system-ui;max-width:820px;margin:40px auto;padding:0 20px;line-height:1.55"><h1>Политика конфиденциальности</h1><p>AI Юрист Казахстан обрабатывает сведения, которые пользователь передает для юридического анализа: описание ситуации, данные карточки дела, хронологию, документы и связанные метаданные.</p><h2>Цель обработки</h2><p>Данные используются только для выполнения запрошенных юридических функций, сохранения контекста дела, подготовки анализа и документов, а также обеспечения работоспособности сервиса.</p><h2>Хранение</h2><p>Карточки дел и связанные структурированные данные могут храниться в защищенной базе Supabase. Серверная часть размещается на Railway. Сервис не должен публиковать пользовательские документы или данные открыто.</p><h2>Минимизация данных</h2><p>Сервис должен избегать возврата лишних персональных данных, технических секретов и внутренних идентификаторов. Пользователю рекомендуется не передавать данные, не относящиеся к юридической задаче.</p><h2>Удаление и исправление</h2><p>Функции удаления и управления данными будут предоставляться через интерфейс сервиса по мере публичного запуска. До публичного запуска сервис используется в тестовом режиме.</p><h2>Ограничение</h2><p>AI Юрист Казахстан не является государственным органом, судом, адвокатом или нотариусом и не заменяет индивидуальную профессиональную помощь в ситуациях, где она обязательна.</p><p>Версия политики: 29 сентября 2026.</p></body></html>`);
    return;
  }

  if (req.method === "GET" && url.pathname === "/terms") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>AI Юрист Казахстан — Условия использования</title></head><body style="font-family:system-ui;max-width:820px;margin:40px auto;padding:0 20px;line-height:1.55"><h1>Условия использования</h1><p>AI Юрист Казахстан предоставляет инструменты для анализа юридических ситуаций по праву Республики Казахстан, организации материалов дела и подготовки проектов документов.</p><h2>Проверка информации</h2><p>Пользователь должен проверять юридически значимые выводы, актуальность законодательства, реквизиты, сроки и фактические обстоятельства перед подачей документов или совершением действий.</p><h2>Ответственность пользователя</h2><p>Пользователь отвечает за точность переданных фактов, законность использования документов и окончательное решение о совершении юридических действий.</p><h2>Недопустимое использование</h2><p>Нельзя использовать сервис для подделки документов, введения суда или государственного органа в заблуждение, незаконного доступа к данным или иных противоправных действий.</p><h2>Изменения</h2><p>Функциональность и условия могут изменяться в ходе тестирования и развития продукта.</p><p>Версия условий: 29 сентября 2026.</p></body></html>`);
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      ok: true,
      service: "AI Юрист Казахстан",
      version: "0.5.0",
      mcp: MCP_PATH
    }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/ready") {
    try {
      const memory = await memoryRequest({ action: "list_cases", limit: 1 });
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        ok: true,
        service: "AI Юрист Казахстан",
        version: "0.5.0",
        mcp: MCP_PATH,
        persistent_memory: "ok",
        remembered_cases: Array.isArray(memory?.cases) ? memory.cases.length : null
      }));
    } catch (error) {
      res.writeHead(503, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        ok: false,
        service: "AI Юрист Казахстан",
        version: "0.5.0",
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
  runMemorySelfTest();
});
