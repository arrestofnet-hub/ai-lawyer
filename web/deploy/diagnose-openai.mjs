#!/usr/bin/env node
// Read-only API connectivity diagnosis for the existing VPS deployment.
// Never prints the API key, secret invite code or any legal case data.
import fs from "node:fs";

const envFile = "/etc/ai-lawyer-web.env";
if (process.getuid?.() !== 0) {
  console.error("Run as root to read the server-side key.");
  process.exit(2);
}
let settings;
try { settings = fs.readFileSync(envFile, "utf8"); }
catch { console.error("No settings file at " + envFile); process.exit(2); }
const read = k => {
  const line = settings.split(/\r?\n/).find(x => x.startsWith(k + "="));
  return line ? line.slice(k.length + 1) : "";
};
const key = read("OPENAI_API_KEY");
const model = read("OPENAI_MODEL") || "gpt-6.1-sol";
if (!key) { console.error("OPENAI_API_KEY is missing"); process.exit(2); }
console.log("AI Lawyer API diagnostics");
console.log("Configured model:", model);
const started = Date.now();
try {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method:"POST",
    headers:{"authorization":"Bearer " + key,"content-type":"application/json"},
    body:JSON.stringify({
      model, store:false,
      input:[{role:"user",content:"Напиши только слово: Проверено"}],
      max_output_tokens:100,
    }),
    signal:AbortSignal.timeout(45000),
  });
  const body = await response.json().catch(()=>({}));
  console.log("Elapsed seconds:", ((Date.now()-started)/1000).toFixed(1));
  console.log("HTTP:", response.status);
  if (response.ok) {
    console.log("Response status:", typeof body.status === "string" ? body.status : "unknown");
    console.log("Output contains text:", (body.output||[]).some(x=>x.type==="message"&&(x.content||[]).some(y=>y.type==="output_text"&&!!y.text)));
    console.log("Diagnostic:", "Basic API works without legal research and web search.");
  } else {
    const type = typeof body.error?.type === "string" ? body.error.type : "unknown";
    const code = typeof body.error?.code === "string" ? body.error.code : "none";
    console.log("Error type:", type.replace(/[^a-zA-Z0-9_-]/g,"").slice(0,100));
    console.log("Error code:", code.replace(/[^a-zA-Z0-9_-]/g,"").slice(0,100));
    console.log("Diagnostic:", "Provider rejected a minimal request; review account access, model and billing.");
  }
} catch (e) {
  console.log("Elapsed seconds:", ((Date.now()-started)/1000).toFixed(1));
  console.log("Failure:", e?.name === "TimeoutError" ? "TIMEOUT" : e?.code === "ENOTFOUND" ? "DNS" : "NETWORK_ERROR");
  console.log("Diagnostic:", "Minimal request did not complete. No API secrets printed.");
}
