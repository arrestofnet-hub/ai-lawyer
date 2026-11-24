// OpenAI API Standard rate cards, USD per 1M provider tokens (18 Nov 2026).
// These values are NOT user-facing AI Lawyer wallet units and may change.
export const RATES=Object.freeze({
  "gpt-6-astra":Object.freeze({input:10,cached:1,output:50}),
  "gpt-6.1-sol":Object.freeze({input:2,cached:0.1,output:10}),
});
export const SEARCH_USD_PER_CALL=0.01;
export function estimateProviderCost(model,usage,webCalls=0){
  if(!usage||typeof usage!=="object")return null;
  const rates=RATES[model];
  if(!rates)return null;
  const input=Math.max(0,Math.floor(Number(usage.input_tokens)||0));
  const output=Math.max(0,Math.floor(Number(usage.output_tokens)||0));
  const cached=Math.min(input,Math.max(0,Math.floor(Number(usage.input_tokens_details?.cached_tokens)||0)));
  const calls=Math.max(0,Math.floor(Number(webCalls)||0));
  const usd=((input-cached)*rates.input+cached*rates.cached+output*rates.output)/1_000_000+
    calls*SEARCH_USD_PER_CALL;
  return {model,inputTokens:input,cachedInputTokens:cached,outputTokens:output,
    webCalls:calls,estimatedUsd:Math.round(usd*1_000_000)/1_000_000};
}
export function sumEstimatedProviderCost(entries,freeOnly=false){
  return (entries||[]).reduce((sum,x)=>sum+
    (!freeOnly||x.free===true ? (Number(x.estimatedUsd)||0):0),0);
}
