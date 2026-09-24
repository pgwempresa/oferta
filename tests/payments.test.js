const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');
const p=require('../lib/payment');
const pix=require('../api/criar-pix');const card=require('../api/criar-cartao');const status=require('../api/status');
const originalFetch=global.fetch;
afterEach(()=>{global.fetch=originalFetch;delete process.env.AMPLO_PUBLIC_KEY;delete process.env.AMPLO_SECRET_KEY;delete process.env.VERCEL});
function setup(){process.env.AMPLO_PUBLIC_KEY='test-public';process.env.AMPLO_SECRET_KEY='test-secret';}
function body(){return {identifier:'test-order-123',email:'teste@example.com',telefone:'5511999999999',quizData:{mom_name:'Responsável'},total:14.9,hasDiscount:true};}
async function call(fn,b,method='POST'){
  let code,data;const headers={};
  await fn({method,body:b,headers:{host:'loja.example',origin:'https://loja.example'},socket:{remoteAddress:'127.0.0.1'}},{setHeader(k,v){headers[k]=v},status(v){code=v;return this},json(v){data=v}});
  return {code,data,headers};
}
test('HTML: scripts válidos e todas as rotas de pagamento apontam para APIs existentes',()=>{
 const html=fs.readFileSync('index.html','utf8');for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
 for(const endpoint of ['criar-pix','criar-cartao','status','config']){assert.ok(html.includes('/api/'+endpoint));assert.ok(fs.existsSync('api/'+endpoint+'.js'))}
 assert.ok(!html.includes("await r.json()"));assert.ok(!html.includes('MercadoPago'));assert.ok(!html.includes('posthog'));assert.ok(!html.includes("d.status === 'OK'"));
});
test('preço calculado pelo servidor e total adulterado rejeitado',()=>{setup();assert.equal(p.total(body()),14.9);assert.equal(p.total({...body(),addon_colorir:true,addon_expressa:true,obExtras:true}),36.6);assert.throws(()=>p.buildOrder({...body(),total:0.01},'pix',{}),/preço/)});
test('credenciais ausentes resultam em JSON 503, sem chamada ao gateway',async()=>{
 global.fetch=()=>{throw Error('Não deveria chamar')};const r=await call(pix,body());assert.equal(r.code,503);assert.match(r.data.erro,/AMPLO_PUBLIC_KEY/);
});
test('Pix: payload correto, resposta normalizada e sem chave secreta',async()=>{
 setup();global.fetch=async(url,options)=>{assert.equal(url,'https://app.amplopay.com/api/v1/gateway/pix/receive');assert.equal(options.headers['x-secret-key'],'test-secret');const o=JSON.parse(options.body);assert.equal(o.amount,14.9);assert.equal(o.client.name,'Responsável');assert.equal(o.products[0].price,o.amount);return new Response(JSON.stringify({transactionId:'tx1',status:'OK',webhookToken:'private',pix:{code:'000201abc',image:'https://example.com/qr.png'}}))};
 const r=await call(pix,body());assert.equal(r.code,200);assert.equal(r.data.status,'pending');assert.equal(r.data.qr_code,'000201abc');assert.equal(p.verify(r.data.statusToken).id,'tx1');assert.ok(!JSON.stringify(r.data).includes('test-secret'));assert.ok(!JSON.stringify(r.data).includes('private'));
});
test('retorno não JSON da operadora tem erro controlado e impede repetição automática',async()=>{setup();global.fetch=async()=>new Response('The page could not be found',{status:502});const r=await call(pix,body());assert.equal(r.code,502);assert.equal(r.data.uncertain,true);assert.match(r.data.erro,/resposta inválida/)});
test('autenticação recusada tem mensagem controlada',async()=>{setup();global.fetch=async()=>new Response('{}',{status:401});const r=await call(pix,body());assert.equal(r.code,502);assert.match(r.data.erro,/autenticação/)});
test('consulta exige token assinado e confirma apenas valor e moeda correspondentes',async()=>{
 setup();global.fetch=async()=>new Response(JSON.stringify({id:'tx1',amount:14.9,currency:'BRL',status:'COMPLETED'}));const r=await call(status,{statusToken:p.ticket('tx1',14.9)});assert.equal(r.data.status,'approved');assert.equal((await call(status,{statusToken:'inventado'})).code,403);
 global.fetch=async()=>new Response(JSON.stringify({id:'tx1',amount:0.01,currency:'BRL',status:'COMPLETED'}));assert.equal((await call(status,{statusToken:p.ticket('tx1',14.9)})).code,409);
});
test('OK na consulta não significa pagamento aprovado',async()=>{setup();global.fetch=async()=>new Response(JSON.stringify({id:'tx1',amount:14.9,currency:'BRL',status:'OK'}));assert.notEqual((await call(status,{statusToken:p.ticket('tx1',14.9)})).data.status,'approved')});
test('cartão usa IP do servidor e OK sem COMPLETED permanece pendente',async()=>{
 setup();const b={...body(),client:{address:{country:'BR',zipCode:'01001000',state:'SP',city:'São Paulo',street:'Rua',number:'1',neighborhood:'Centro'}},card:{number:'4111111111111111',owner:'Teste',expiresAt:'2030-12',cvv:'123'},installments:1,clientIp:'9.9.9.9'};
 global.fetch=async(url,opts)=>{assert.equal(JSON.parse(opts.body).clientIp,'127.0.0.1');return new Response(JSON.stringify({transactionId:'tx-card',status:'OK'}))};const r=await call(card,b);assert.equal(r.code,200);assert.equal(r.data.status,'pending');assert.ok(!JSON.stringify(r.data).includes('4111111111111111'));
});
test('método incorreto rejeitado como JSON',async()=>{assert.equal((await call(pix,{},'GET')).code,405)});
test('telefone nacional é enviado com DDD sem prefixo 55 duplicado',()=>{setup();assert.equal(p.buildOrder(body(),'pix',{}).client.phone,'11999999999')});
test('mostra código e campo recusado sem expor dados do comprador ou credenciais',async()=>{
 setup();global.fetch=async()=>new Response(JSON.stringify({errorCode:'GATEWAY_INVALID_DATA',message:'Dados inválidos',details:[{path:'client.phone',error:{message:'Invalid phone 5511999999999 for teste@example.com test-secret test-public'}}]}),{status:400});
 const r=await call(pix,body());assert.equal(r.code,422);assert.match(r.data.erro,/GATEWAY_INVALID_DATA/);assert.match(r.data.erro,/client.phone/);for(const value of ['5511999999999','teste@example.com','test-secret','test-public'])assert.ok(!r.data.erro.includes(value));
});
test('recusa HTTP 200 preserva motivo e falha 500 bloqueia repetição ambígua',async()=>{
 setup();global.fetch=async()=>new Response(JSON.stringify({status:'REJECTED',errorDescription:'ACQUIRER_REJECTED'}));assert.match((await call(pix,body())).data.erro,/ACQUIRER_REJECTED/);
 global.fetch=async()=>new Response(JSON.stringify({message:'Unavailable'}),{status:500});assert.equal((await call(pix,body())).data.uncertain,true);
});
