'use strict';
const {createHmac,timingSafeEqual}=require('node:crypto');
const {isIP}=require('node:net');
const prices={base:3990,discount:2500,colorir:790,expressa:390,extras:990};
class PaymentError extends Error{constructor(message,status=400,uncertain=false){super(message);this.status=status;this.uncertain=uncertain}}
function keys(){
  const pub=process.env.AMPLO_PUBLIC_KEY?.trim(),secret=process.env.AMPLO_SECRET_KEY?.trim();
  if(!pub||!secret)throw new PaymentError('Configure AMPLO_PUBLIC_KEY e AMPLO_SECRET_KEY nas variáveis de Production da Vercel e faça um novo deploy.',503);
  return {pub,secret};
}
function text(v,max=160){return typeof v==='string'?v.trim().slice(0,max):''}
function input(req){
  const b=typeof req.body==='string'?JSON.parse(req.body):req.body;
  if(!b||typeof b!=='object'||Array.isArray(b))throw new PaymentError('Dados do pedido ausentes.');
  if(Buffer.byteLength(JSON.stringify(b))>40000)throw new PaymentError('Pedido muito grande.',413);
  return b;
}
function total(b){return (prices.base-(b.hasDiscount===true?prices.discount:0)+(b.addon_colorir===true?prices.colorir:0)+(b.addon_expressa===true?prices.expressa:0)+(b.obExtras===true?prices.extras:0))/100}
function buildOrder(b,method,req){
  const {secret}=keys();
  const name=text(b.client?.name||b.quizData?.mom_name),email=text(b.email||b.client?.email),phone=text(b.telefone||b.client?.phone,30).replace(/\D/g,'');
  if(!name||!/^\S+@\S+\.\S+$/.test(email)||phone.length<10||phone.length>15)throw new PaymentError('Preencha nome do responsável, e-mail e telefone válidos.');
  if(!/^[a-zA-Z0-9_-]{8,120}$/.test(b.identifier||''))throw new PaymentError('Identificador do pedido inválido. Atualize a página.');
  const amount=total(b);
  if(Number(b.total)!==amount)throw new PaymentError('O preço do pedido mudou. Atualize a página antes de pagar.',409);
  const identifier='hist_'+createHmac('sha256',secret).update(method+':'+b.identifier+':'+amount).digest('hex').slice(0,40);
  // O formulário acrescenta 55; a API documenta telefone nacional com DDD (10/11 dígitos).
  const nationalPhone=phone.startsWith('55')&&[12,13].includes(phone.length)?phone.slice(2):phone;
  const client={name,email,phone:nationalPhone};
  if(b.client?.document)client.document=text(b.client.document,30).replace(/\D/g,'');
  const order={identifier,amount,client,products:[{id:'sua-historinha',name:'Sua Historinha e adicionais selecionados',quantity:1,price:amount,physical:false}],metadata:{provider:'Sua Historinha',orderId:identifier}};
  if(method==='card'){
    const a=b.client?.address||{};
    if(a.country!=='BR')throw new PaymentError('Informe um endereço de cobrança no Brasil.');
    client.address={country:'BR'};
    for(const k of ['zipCode','state','city','street','neighborhood','number']){client.address[k]=text(a[k]);if(!client.address[k])throw new PaymentError('Preencha o endereço completo de cobrança.');}
    if(!/^\d{8}$/.test(client.address.zipCode.replace(/\D/g,''))||! /^[A-Z]{2}$/.test(client.address.state))throw new PaymentError('Confira o CEP e a sigla do estado.');
    const card=b.card||{},number=text(card.number,32).replace(/[ -]/g,''),owner=text(card.owner),expiresAt=text(card.expiresAt,7),cvv=text(card.cvv,4);
    if(!/^\d{13,19}$/.test(number)||!owner||!/^\d{4}-(0[1-9]|1[0-2])$/.test(expiresAt)||!/^\d{3,4}$/.test(cvv))throw new PaymentError('Confira número, titular, validade (AAAA-MM) e CVV do cartão.');
    const now=new Date();if(expiresAt<now.toISOString().slice(0,7))throw new PaymentError('O cartão está vencido.');
    // Só confiar no cabeçalho de IP sobrescrito pela plataforma Vercel.
    let ip=process.env.VERCEL?text(req.headers['x-vercel-forwarded-for'],100).split(',')[0].trim():req.socket?.remoteAddress;
    if(ip?.startsWith('::ffff:'))ip=ip.slice(7);
    if(isIP(ip||'')!==4)throw new PaymentError('Não foi possível identificar um IPv4 válido para o cartão. Utilize Pix.',422);
    if(Number(b.installments||1)!==1)throw new PaymentError('O cartão está disponível em uma parcela.');
    order.clientIp=ip;order.card={number,owner,expiresAt,cvv};order.installments=1;
  }
  return order;
}
function gatewayReason(d,body,credentials){
  const privateValues=[credentials.pub,credentials.secret];
  function collect(value){if(typeof value==='string'&&value.length>=3)privateValues.push(value);else if(value&&typeof value==='object')Object.values(value).forEach(collect)}
  collect(body?.client);collect(body?.card);
  function safe(value){
    if(typeof value!=='string')return '';
    let s=value;
    for(const v of privateValues.sort((a,b)=>b.length-a.length))s=s.split(v).join('[oculto]');
    return s.replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g,'[e-mail oculto]').replace(/\d(?:[ .()-]*\d){7,}/g,'[número oculto]').replace(/<[^>]*>/g,'').replace(/[\r\n\t]+/g,' ').slice(0,240);
  }
  const parts=[];
  const code=typeof d?.errorCode==='string'&&/^[A-Z][A-Z0-9_]{2,80}$/.test(d.errorCode)?d.errorCode:'';
  if(code)parts.push(code);
  const message=safe(d?.errorDescription)||safe(d?.message)||safe(d?.details);
  if(message)parts.push(message);
  if(Array.isArray(d?.details))for(const detail of d.details.slice(0,4)){
    const path=typeof detail.path==='string'?detail.path:Array.isArray(detail.path)?detail.path.join('.'):'campo';
    const description=safe(detail.error?.message||detail.message);
    if(description)parts.push(safe(path)+': '+description);
  }
  return parts.join(' — ')||'A operadora não informou o motivo. Consulte o painel Amplo Pay.';
}
async function request(path,body){
  const {pub,secret}=keys();let r;
  try{r=await fetch('https://app.amplopay.com/api/v1'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-public-key':pub,'x-secret-key':secret},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});}
  catch{throw new PaymentError(body?'Não foi possível confirmar a resposta da operadora. Confira o painel Amplo Pay antes de tentar uma nova cobrança.':'Não foi possível consultar o pagamento agora.',502,!!body);}
  let d;try{d=await r.json()}catch{throw new PaymentError('A operadora retornou uma resposta inválida. Confira o painel Amplo Pay antes de repetir.',502,!!body)}
  if(r.status===401||r.status===403)throw new PaymentError('A Amplo Pay recusou a autenticação ou o acesso desta hospedagem. Confira as duas chaves e as permissões da conta.',502);
  if(!r.ok||['FAILED','REJECTED','CANCELED'].includes(d?.status))throw new PaymentError(r.status===429?'Limite de requisições da operadora. Aguarde antes de tentar novamente.':`Amplo Pay (HTTP ${r.status}): ${gatewayReason(d,body,{pub,secret})}`,r.status===429?429:422,r.status>=500&&!!body);
  return d;
}
function ticket(id,amount){const raw=Buffer.from(JSON.stringify({id,amount,exp:Date.now()+48*3600000})).toString('base64url');return raw+'.'+createHmac('sha256',keys().secret).update(raw).digest('base64url')}
function verify(token){
  const [raw,sig,...extra]=String(token||'').split('.');if(!raw||!sig||extra.length)throw new PaymentError('Comprovante de consulta inválido.',403);
  const expected=createHmac('sha256',keys().secret).update(raw).digest();const actual=Buffer.from(sig,'base64url');
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new PaymentError('Comprovante de consulta inválido.',403);
  let d;try{d=JSON.parse(Buffer.from(raw,'base64url'))}catch{throw new PaymentError('Comprovante de consulta inválido.',403)}
  if(d.exp<Date.now())throw new PaymentError('Consulta expirada. Consulte o atendimento.',403);return d;
}
function route(method,fn){return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method!==method){res.setHeader('Allow',method);return res.status(405).json({erro:'Método não permitido.'})}
  try{
    if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)throw new PaymentError('Origem não permitida.',403);
    return res.status(200).json(await fn(req));
  }catch(e){return res.status(e instanceof PaymentError?e.status:400).json({erro:e instanceof PaymentError?e.message:'Não foi possível processar os dados do pedido.',uncertain:e.uncertain===true})}
}}
module.exports={PaymentError,keys,input,total,buildOrder,request,ticket,verify,route};
