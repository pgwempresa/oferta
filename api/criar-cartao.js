const p=require('../lib/payment');
module.exports=p.route('POST',async req=>{
  const input=p.input(req);
  const order=p.buildOrder(input,'card',req);
  const d=await p.request('/gateway/card/receive',order);
  if(!d.transactionId)throw new p.PaymentError('A operadora não retornou o identificador. Confira o painel antes de tentar novamente.',502,true);
  return {id:d.transactionId,total:order.amount,status:d.transactionStatus==='COMPLETED'?'approved':'pending',statusToken:p.ticket(d.transactionId,order.amount)};
});
