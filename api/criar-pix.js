const p=require('../lib/payment');
const meta=require('../lib/meta');
module.exports=p.route('POST',async req=>{
  const input=p.input(req);
  const order=p.buildOrder(input,'pix',req);
  const d=await p.request('/gateway/pix/receive',order);
  if(!d.transactionId||!d.pix?.code)throw new p.PaymentError('A operadora não retornou o código Pix. Confira o painel antes de gerar novamente.',502,true);
  const metaEventId=await meta.pixGenerated(req,input,order,d.transactionId);
  return {metaEventId,id:d.transactionId,total:order.amount,qr_code:d.pix.code,pix:{code:d.pix.code,image:typeof d.pix.image==='string'&&d.pix.image.startsWith('https://')?d.pix.image:undefined,expiresAt:d.pix.expiresAt},statusToken:p.ticket(d.transactionId,order.amount),status:'pending'};
});
