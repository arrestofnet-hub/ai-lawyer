# AI Юрист Казахстан

MCP-плагин для ChatGPT/Codex по законодательству Республики Казахстан.

## Что уже реализовано

Сервис построен как связка:

```
ChatGPT / MCP client
        ↓
Production MCP server
        ↓
Supabase persistent case memory
        ↓
официальные источники права РК
```

Основные инструменты:

- `legal_case_intake` — структурирование юридической ситуации;
- `case_memory_create` / `case_memory_search` / `case_memory_get` — постоянная память дел;
- `case_memory_update` — история существенных изменений;
- `case_memory_add_fact` — факты, утверждения сторон, гипотезы, пробелы и риски;
- `case_memory_add_event` — хронология;
- `case_memory_add_document` — сведения и юридически значимая сводка документа;
- `contradiction_audit` — поиск противоречий;
- `second_lawyer_review` — независимая перепроверка позиции;
- `analyze_legal_document` — разбор юридического документа;
- `compare_case_documents` — сопоставление двух документов/версий;
- `case_strategy` — стратегия по делу;
- `kz_law_research` — правила правовой проверки;
- `kz_official_act_fetch` — получение НПА из официального ЭКБ РК по идентификатору;
- `draft_legal_document` — подготовка проекта юридического документа;
- `case_memory_delete` — удаление сохранённого дела после явного подтверждения.

## Принцип работы

AI Юрист должен работать не как справочник, а как второй юрист по делу:

1. отделять подтверждённые факты от утверждений и гипотез;
2. удерживать хронологию, суммы, документы и позиции сторон;
3. искать противоречия и недостающие первичные доказательства;
4. проверять альтернативную версию другой стороны;
5. перепроверять нормы по официальному источнику и юридически значимой дате;
6. сохранять существенные изменения в карточке дела;
7. давать конкретный следующий процессуальный шаг.

## Развёртывание

Website: `https://ailawyer.kz`

Production:

- Health: `https://mcp.ailawyer.kz/health`
- Readiness + persistent memory check: `https://mcp.ailawyer.kz/ready`
- MCP: `https://mcp.ailawyer.kz/mcp`
- Privacy: `https://mcp.ailawyer.kz/privacy`
- Terms: `https://mcp.ailawyer.kz/terms`

## Контроль качества

GitHub Actions smoke-test проверяет внешний production MCP: discovery инструментов, доступ к официальному источнику и реальный цикл записи/чтения постоянной памяти.

Секреты не хранятся в репозитории. Production service receives them through environment variables.
