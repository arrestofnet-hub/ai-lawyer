# Commercial launch legal gates — 2026-11-24
Drafts only; do not serve these markdown files to users yet. Seller details were supplied for the website and should be configured on the VPS rather than committed to the public repository. Confirm legal and actual address, Kazakh/Russian rendering, contact email, hours and any additional required business identifiers.

Before accepting payment:
- Confirm provider/data-center and backup locations, subprocessors, actual retention periods, cross-border transfer legal basis, and applicable data processing notification/registry duties under the current RK law.
- Implement separate, affirmative, versioned agreement and personal-data consent before guest chat/upload, email/Google registration and relevant processing. Provide withdrawal/support path. Preserve consent evidence (subject/session, version, timestamp, scope). Do not treat a link or prechecked box as consent.
- Confirm token validity/no auto-renewal and refund policy with seller, publish exact tariff and operation limits before purchase, provide order confirmation and fiscal receipt, implement refunds/reconciliation.
- Display legal links before use and checkout; publish bilingual texts without placeholders or draft labels only after review. Provide official consumer protection link; check current law and contact details.
- Confirm AI disclosure and applicable system documentation/marking requirements, including export documents.
- Verify backup/restore and single-writer deployment, actual payment provider sandbox tests; keep payments disabled until all gates pass.

Legal review sources:
https://adilet.zan.kz/rus/docs/Z1300000094 (personal data, arts. 7, 8, 12, 16)
https://adilet.zan.kz/rus/docs/Z100000274_ (consumer rights, arts. 24–26, 33-2, 42-4)
https://adilet.zan.kz/rus/docs/K990000409_ (services, arts. 683–686)
https://adilet.zan.kz/rus/docs/Z2500000230 (AI user rights, transparency, owner obligations)
Official law page fetches were partially unavailable during drafting; recheck current full texts before publication. These documents are for standalone web, not a rewrite of the existing MCP plugin policy.

## Review 24 November 2026 — publication blockers
- Compared Macro.Legal (offer, privacy, payment rules), OP-ONAI and Alten; adapted to one-time credits, no recurring charges. No wholesale transfer of another provider's terms.
- Current law: PD Law art. 8(4)–(7), 12, 16, 25; rules 395/НҚ (02.10.2026 revision), protection rules 179/НҚ as amended in 2026; breach notification rules 481/НҚ as amended. Establish approved necessary/sufficient data list, responsible person/process, security logs, breach response and verify cross-border obligations. https://prg.kz/document/?doc_id=31396226 ; https://prg.kz/document/?doc_id=39051375 ; https://old.adilet.zan.kz/rus/docs/V2600039038 ; https://insecure.zan.kz/rus/docs/V2400034919
- AI Law 230-VIII (25.08.2026 revision), arts. 15–18, 21–23. Risk assessment, system documentation, explanation workflow, visible AI warning, assess machine-readable marking of synthetic results including exports. https://prg.kz/m/amp/document/34207749/ ; https://old.adilet.zan.kz/rus/docs/V2600038444
- Provider controls: https://developers.openai.com/api/docs/guides/your-data . Default retention is not zero; verify project settings and processor terms. Disable forwarding customer support content to Gmail until its legal basis, location/retention and policy are established. No raw customer email to AI; test-only code currently active. Check web-search query minimization; block restricted material and unnecessary third-party identifiers before external transfer. Do not claim unrestricted document processing is safe by consent alone.
- Code confirms 90-day guest expiry (not guaranteed deletion); 1/30-day session expiry; 15-minute verification expiry. Implement scheduled cleanup, full account deletion/withdrawal, evidence retention and backup restore handling. Existing backup uses -mtime +14, not exact 14-day TTL; verify and align before claiming 14-day maximum. Add legal config to encrypted backup; verify restoration and separate Kazakhstan storage. Do not publish draft statements as implemented guarantees.
- Consumer law and GK art. 686: no blanket nonrefund or liability waiver. Implement auditable paid vs bonus consumption and refund calculation before live charges; do not assume current combined balance can identify refundable units. Check statutory receipt and tax obligations: https://old.adilet.zan.kz/rus/docs/V2500037238 and amendments V2600039810.
- Legal text review is not approval of technical compliance. Official Adilet direct fetch sometimes returned 502; current PRG versions and indexed official sources cross-checked. Need provider details, merchant tax identifiers/registration details and actual business hours, verified retention and release tests. No live activation until completed.
