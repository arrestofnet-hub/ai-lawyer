#!/usr/bin/env node
// Run as root with env loaded from /etc/ai-lawyer-web.env.
// Prints aggregate estimated provider costs only, never emails or credentials.
import path from "node:path";
import {Store,dataKey} from "../core.mjs";
import {sumEstimatedProviderCost} from "../pricing.mjs";
const dir=process.env.DATA_DIR||path.resolve("private-data");
if(!process.env.DATA_KEY)throw Error("DATA_KEY is missing: load the private server env first");
const data=new Store(dir,dataKey(process.env.DATA_KEY));
const records=data.db.providerUsage||[];
const day=Date.now()-24*3600*1000;
const recent=records.filter(x=>Date.parse(x.at)>=day);
const total=records.length;
const fmt=n=>"$"+Number(n).toFixed(4);
console.log("Provider estimated cost summary (USD, not the real API invoice)");
console.log("Responses with usage metadata:",total);
console.log("Last 24h estimated:",fmt(sumEstimatedProviderCost(recent)));
console.log("All measured estimated:",fmt(sumEstimatedProviderCost(records)));
console.log("Trial/guest all measured:",fmt(sumEstimatedProviderCost(records,true)));
console.log("Free ceiling:",fmt(Number(process.env.FREE_API_BUDGET_USD||15)));
console.log("OpenAI API account balance is NOT readable from this script.");
console.log("Real invoice may include failed calls and other API consumers.");
