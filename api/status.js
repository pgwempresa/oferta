const p=require('../lib/payment');
module.exports=p.route('POST',async req=>{
  const t=p.verify(p.input(req).statusToken);
  const d=await p.request('/gateway/transactions?id='+encodeURIComponent(t.id));
  if(d.id!==t.id||d.currency!=='BRL'||Math.round(Number(d.amount)*100)!==Math.round(t.amount*100))throw new p.PaymentError('Os dados do pagamento não correspondem ao pedido.',409);
  return {status:d.status==='COMPLETED'?'approved':String(d.status||'PENDING').toLowerCase()};
});
