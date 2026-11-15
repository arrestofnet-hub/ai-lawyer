# Closed pilot deploy checklist (existing Hoster VPS)

**Never run on the public site until HTTPS, secret storage and protected registration are verified.**
Existing MCP and invite URL must remain unchanged.

1. Back up current Nginx configuration and app directories. Do not change existing MCP service or port 8787.
2. On Ubuntu install Node 22+ and git. Check with node -v, git --version.
3. Clone the repository in a *separate* directory /opt/ai-lawyer-web at feature/standalone-legal-web-v1, not over the MCP checkout.
4. Install service unit web/deploy/ai-lawyer-web.service to /etc/systemd/system/ai-lawyer-web.service.
5. As root create /etc/ai-lawyer-web.env with chmod 0600. Put DATA_KEY (openssl rand -hex 32), OPENAI_API_KEY (separate paid API), SIGNUP_INVITE_CODE, PUBLIC_ORIGIN=https://ailawyer.kz, DATA_DIR=/var/lib/ai-lawyer-web, HOST=127.0.0.1, PORT=8791, OPENAI_MODEL and request limits. Never put secrets in Git.
6. systemctl daemon-reload; systemctl enable --now ai-lawyer-web; check journalctl -u ai-lawyer-web without exposing secrets. Check http://127.0.0.1:8791/chat/health.
7. Add only the isolated /chat/ location from nginx-location.conf to the existing HTTPS server; nginx -t before systemctl reload nginx.
8. Verify https://ailawyer.kz/chat/, login, another test account cannot access the first one's case, PDF and DOCX uploads, OpenAI answer, official source links, two-pass review and case deletion.
9. Ensure all requests are HTTPS, cookies HttpOnly/Secure, no public registration without code, no excessive requests, encrypted case storage, backups and a tested recovery path.
10. Complete legal personal-data compliance review, user terms and consent before public onboarding.
11. Pilot only with synthetic/consented documents. Analyze legal answers against rubric and fix regressions before charging users.
12. Maintain backups of /var/lib/ai-lawyer-web and separately secured DATA_KEY. One local process only; migrate to transactional database before scaling.

Rollback: remove only Nginx /chat/ location and stop ai-lawyer-web service. MCP and /invite/ remain intact.

**Note:** This checklist is an artifact prepared in the repository, not evidence that the VPS was accessed, configured, or deployed.
