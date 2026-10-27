import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const endpoint = process.env.MCP_URL || 'https://mcp.ailawyer.kz/mcp';
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const client = new Client({name:'ai-lawyer-kz-smoke',version});
const fixtures = {
 structure_legal_case:{facts:'Test payment date differs between two supplied letters.',objective:'Compare payment evidence'},
 prepare_kazakhstan_law_research:{legal_issue:'Check rules for a reasoned administrative response'},
 prepare_case_strategy:{facts:'The authority responded without the requested attachments.',objective:'Request the missing evidence'},
 prepare_contradiction_audit:{materials:'Letter A states January; letter B states June for the same payment.'},
 prepare_legal_position_review:{position:'The payment date is disputed because the letters conflict.',objective:'Assess supporting evidence'},
 prepare_legal_document_analysis:{document_text:'The authority states no violation was found and attaches no evidence.'},
 prepare_document_comparison:{document_a:'The first letter states that payment was received in January.',document_b:'The second letter states that payment was received in June.'},
 prepare_legal_document_draft:{document_type:'Complaint',addressee:'Authority',applicant:'Test applicant',facts:'The response did not include the requested supporting materials.',requests:['Provide a reasoned response and the supporting materials']}
};
try {
 await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
 assert.equal(client.getServerVersion()?.version,version,`MCP at ${endpoint} must serve release ${version}; check deployment before changing tool names`);
 const {tools}=await client.listTools();
 const expected=[...Object.keys(fixtures),'fetch_kazakhstan_legal_act'].sort();
 assert.deepEqual(tools.map(t=>t.name).sort(),expected,'Public tools must match the 1.0.1 listing; legacy names indicate an outdated deployment');
 for(const tool of tools){
  for(const flag of ['readOnlyHint','destructiveHint','openWorldHint']) assert.equal(typeof tool.annotations?.[flag],'boolean',`${tool.name}: ${flag}`);
  assert.equal(tool.annotations.readOnlyHint,true);
  for(const [field,schema] of Object.entries(tool.inputSchema.properties)) assert.ok(schema.description,`${tool.name}.${field}: missing description`);
 }
 for(const [name,args] of Object.entries(fixtures)){
  const result=await client.callTool({name,arguments:args});
  assert.ok(!result.isError,`${name}: tool failed`);
  const serialized=JSON.stringify(result);
  for(const value of Object.values(args).filter(v=>typeof v==='string')) assert.ok(serialized.includes(value),`${name}: supplied facts lost`);
 }
 console.log(`SMOKE_OK: ${tools.length} public read-only tools; eight template calls preserve supplied facts`);
} catch(error){ console.error(error);process.exitCode=1; }
finally{await client.close();}
