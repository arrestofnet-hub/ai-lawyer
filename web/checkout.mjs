import {createOrder,settleVerifiedPayment} from "./payments.mjs";

// Each real adapter must implement idempotent initiation by merchant order ID
// and fetch the authoritative captured status directly from the provider.
// No live adapters are configured in this release.
function adapterFor(adapters,provider){
  if(!Object.hasOwn(adapters,provider))throw Error("Payment provider unavailable");
  const adapter=adapters[provider];
  if(!adapter||typeof adapter.initiate!=="function"||typeof adapter.fetchPayment!=="function")
    throw Error("Payment provider unavailable");
  return adapter;
}
function checkoutUrl(raw,origins){
  const url=new URL(raw);
  if(url.protocol!=="https:"||url.username||url.password||
     !Array.isArray(origins)||!origins.includes(url.origin))
    throw Error("Untrusted checkout URL");
  return url.href;
}
export async function startCheckout(store,adapters,request){
  const adapter=adapterFor(adapters,request.provider);
  const order=createOrder(store,request);
  if(order.status!=="pending")return {order,checkoutUrl:null};
  const result=await adapter.initiate({orderId:order.id,amountMinor:order.priceKzt*100,currency:order.currency});
  if(result?.orderId!==order.id)throw Error("Checkout order mismatch");
  return {order,checkoutUrl:checkoutUrl(result.checkoutUrl,adapter.checkoutOrigins)};
}
export async function reconcileCheckout(store,adapters,{provider,orderId}){
  const adapter=adapterFor(adapters,provider);
  const order=store.db.paymentOrders?.find(o=>o.id===orderId&&o.provider===provider);
  if(!order)throw Error("Unknown payment order");
  const evidence=await adapter.fetchPayment({orderId:order.id});
  if(evidence?.orderId!==order.id||evidence?.provider!==provider||
     evidence?.amountMinor!==order.amountMinor||evidence?.currency!==order.currency)
    throw Error("Payment verification mismatch");
  if(evidence.status!=="captured")return {credited:false,status:order.status};
  return settleVerifiedPayment(store,evidence);
}
