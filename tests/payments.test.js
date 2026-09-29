const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');
const p=require('../lib/payment');
const pix=require('../api/criar-pix');const card=require('../api/criar-cartao');const status=require('../api/status');const recovery=require('../api/recovery');const processEmailJobs=require('../api/process-email-jobs');
const originalFetch=global.fetch;
test('Pix e cartão aprovados encaminham principal para upsell e upsell para obrigado',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html, /id="sc-aprovado"[\s\S]*?Seu pedido entrou na fila de geração! Você receberá o PDF no e-mail informado em até 1 hora\./);
 assert.match(html, /function handleApprovedPayment\(email\)\{[\s\S]*?if\(checkoutMode === 'upsell'\) goTo\('aprovado'\);[\s\S]*?else goTo\('upsell1'\);/);
 assert.match(html, /if\(data\.status==='approved'\)\{[\s\S]*?handleApprovedPayment\(pendingPayment\.email\)/);
 assert.match(html, /if\(d\.status === 'approved' \|\| d\.transactionStatus === 'COMPLETED'\)\{[\s\S]*?handleApprovedPayment\(email\)/);
});
test('promessa de entrega é consistente em até uma hora',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.doesNotMatch(html,/10 horas/);
 assert.match(html,/com entrega por e-mail em até 1 hora\./);
});
test('documento do checkout limita a 14 dígitos e formata CPF/CNPJ',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/id="fDocument"[^>]*maxlength="18"/);
 assert.match(html,/replace\(\/\\D\/g,''\)\.slice\(0,14\)/);
});
test('player de depoimento usa MediaDelivery sem loop e sem VTurb antigo',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/https:\/\/player\.mediadelivery\.net\/embed\/764426\/cb1d8670-f5bf-461e-83eb-26ad06044819\?[^"]*loop=false/);
 assert.doesNotMatch(html,/vturb-smartplayer/);
 assert.doesNotMatch(html,/scripts\.converteai\.net\/5a997ec4/);
});
test('ícones das telas de feedback e popup estão visíveis e usam os arquivos enviados',()=>{
 const html=fs.readFileSync('index.html','utf8');
 for(const icon of ['icone-rosto.webp','icone-aventura.webp','icone-final.webp','icone-presente.webp']){
   assert.match(html,new RegExp('images/'+icon));
   assert.doesNotMatch(html,new RegExp('images/'+icon+'[^>]*style="display: none;"'));
 }
});
test('checkout mostra o logo do Mercado Pago abaixo da mensagem de segurança',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/class="kw-mp-trust"><img src="images\/mercadopago-nuevo-logo-png_seeklogo-397917%20%281%29\.png"/);
 assert.match(html,/\.kw-mp-trust/);
 assert.doesNotMatch(html,/kw-mp-logo/);
});
test('checkout de cartão tem máscara e busca automática de CEP',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/https:\/\/viacep\.com\.br\/ws\//);
 assert.match(html,/id="cepStatus"/);
 assert.match(html,/20\$\{expiryParts\[1\]\}-\$\{expiryParts\[0\]\}/);
 assert.match(html,/id="cardNumber"[^>]*maxlength="23"/);
});
test('validade aceita ano com dois ou quatro dígitos e CVV segue 3 ou 4',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/id="cardExpiry"[^>]*maxlength="7" placeholder="MM\/AA"/);
 assert.match(html,/id="cardCvv"[^>]*maxlength="4" placeholder="Ex\.: 123"/);
 assert.match(html,/\^\\d\{2\}\\\/\\d\{4\}\$/);
});
test('cartão mantém campos da cobrança e hierarquia visual do checkout',()=>{
 const html=fs.readFileSync('index.html','utf8');
 for(const id of ['cardNumber','cardExpiry','cardCvv','cardOwner','cardZip','cardStreet','cardNumberAddress','cardNeighborhood','cardCity','cardState','cardInstallments']) assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/class="card-panel-title">Cartão de crédito/);
 assert.match(html,/class="card-address-title">Endereço de cobrança/);
 assert.match(html,/class="card-brands"/);
});
afterEach(()=>{global.fetch=originalFetch;delete process.env.AMPLO_PUBLIC_KEY;delete process.env.AMPLO_SECRET_KEY;delete process.env.SUPABASE_URL;delete process.env.SUPABASE_SERVICE_ROLE_KEY;delete process.env.BREVO_API_KEY;delete process.env.BREVO_FROM_EMAIL;delete process.env.BREVO_FROM_NAME;delete process.env.EMAIL_JOBS_SECRET;delete process.env.CRON_SECRET;delete process.env.VERCEL;delete process.env.VERCEL_ENV;delete process.env.PUBLIC_SITE_URL});
function setup(){process.env.AMPLO_PUBLIC_KEY='test-public';process.env.AMPLO_SECRET_KEY='test-secret';}
function body(){return {identifier:'test-order-123',email:'teste@example.com',telefone:'5511999999999',document:'529.982.247-25',quizData:{mom_name:'Responsável'},total:14.9,hasDiscount:true};}
async function call(fn,b,method='POST'){
  let code,data;const headers={};
  await fn({method,body:b,headers:{host:'loja.example',origin:'https://loja.example'},socket:{remoteAddress:'127.0.0.1'}},{setHeader(k,v){headers[k]=v},status(v){code=v;return this},json(v){data=v}});
  return {code,data,headers};
}
async function callApi(fn,{method='GET',query={},headers={}}={}){
 let code,data;const responseHeaders={};
 await fn({method,query,headers:{host:'loja.example',...headers}},{setHeader(k,v){responseHeaders[k]=v},status(v){code=v;return this},json(v){data=v}});
 return {code,data,headers:responseHeaders};
}
test('HTML: scripts válidos e todas as rotas de pagamento apontam para APIs existentes',()=>{
 const html=fs.readFileSync('index.html','utf8');for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
 for(const endpoint of ['criar-pix','criar-cartao','status','config','recovery']){assert.ok(html.includes('/api/'+endpoint));assert.ok(fs.existsSync('api/'+endpoint+'.js'))}
 assert.ok(!html.includes("await r.json()"));assert.ok(!html.includes('MercadoPago'));assert.ok(!html.includes('posthog'));assert.ok(!html.includes("d.status === 'OK'"));
});
test('recuperação de e-mail é fire-and-forget e não bloqueia checkout',async()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/function sendRecoveryEvent\(status, extra\)\{[\s\S]*?fetch\('\/api\/recovery'/);
 assert.match(html,/fetch\('\/api\/recovery'[\s\S]*?\.catch\(\(\)=>\{\}\)/);
 assert.match(html,/sendRecoveryEvent\('checkout_opened'/);
 assert.match(html,/sendRecoveryEvent\('pix_pending'/);
 assert.match(html,/sendRecoveryEvent\('paid'/);
 const r=await call(recovery,{status:'checkout_opened',email:'teste@example.com',quizData:{mom_name:'Maria',child_name:'Miguel'},total:14.9});
 assert.equal(r.code,200);
 assert.equal(r.data.ok,true);
 assert.equal(r.data.skipped,true);
});
test('recuperação agenda jobs de carrinho e Pix pendente sem expor service role',async()=>{
 process.env.SUPABASE_URL='https://supabase.test';
 process.env.SUPABASE_SERVICE_ROLE_KEY='service-secret';
 const calls=[];
 global.fetch=async(url,options)=>{
   calls.push({url,options});
   assert.equal(options.headers.Authorization,'Bearer service-secret');
   if(url.includes('/checkout_leads?select='))return new Response('[]');
   if(url.endsWith('/rest/v1/checkout_leads'))return new Response(JSON.stringify([{id:'lead-1'}]));
   if(url.includes('/rest/v1/email_jobs?on_conflict='))return new Response(JSON.stringify([{id:'job-1'}]));
   throw new Error('URL inesperada: '+url);
 };
 const r=await call(recovery,{status:'pix_pending',email:'teste@example.com',quizData:{mom_name:'Maria',child_name:'Miguel'},payment_method:'pix',payment_id:'tx1',status_token:'token',amount:14.9});
 assert.equal(r.code,200);
 assert.equal(r.data.ok,true);
 assert.equal(calls.filter(c=>c.url.includes('/rest/v1/email_jobs?on_conflict=')).length,2);
 const firstJob=JSON.parse(calls.find(c=>c.url.includes('/rest/v1/email_jobs?on_conflict=')).options.body);
 assert.equal(firstJob.lead_id,'lead-1');
 assert.equal(firstJob.kind,'pix_reminder');
 assert.equal(firstJob.status,'scheduled');
 assert.ok(!JSON.stringify(r.data).includes('service-secret'));
});
test('processador de email_jobs envia Brevo e marca job como enviado',async()=>{
 process.env.SUPABASE_URL='https://supabase.test';
 process.env.SUPABASE_SERVICE_ROLE_KEY='service-secret';
 process.env.BREVO_API_KEY='brevo-secret';
 process.env.BREVO_FROM_EMAIL='contato@example.com';
 process.env.BREVO_FROM_NAME='Sua Historinha';
 process.env.EMAIL_JOBS_SECRET='job-secret';
 process.env.PUBLIC_SITE_URL='https://loja.example';
 const calls=[];
 global.fetch=async(url,options)=>{
   calls.push({url,options});
   if(url.includes('/email_jobs?select='))return new Response(JSON.stringify([{
     id:'job-1',kind:'pix_reminder',status:'scheduled',
     checkout_leads:{child_name:'Miguel',email:'cliente@example.com',amount:14.9}
   }]));
   if(url.includes('/rest/v1/email_jobs?id=eq.job-1'))return new Response(JSON.stringify([{id:'job-1'}]));
   if(url==='https://api.brevo.com/v3/smtp/email'){
     const body=JSON.parse(options.body);
     assert.equal(options.headers['api-key'],'brevo-secret');
     assert.equal(body.sender.email,'contato@example.com');
     assert.equal(body.to[0].email,'cliente@example.com');
     assert.match(body.subject,/Miguel/);
     assert.match(body.htmlContent,/Falta só pagar o Pix/);
     return new Response(JSON.stringify({messageId:'m1'}));
   }
   throw new Error('URL inesperada: '+url);
 };
 const r=await callApi(processEmailJobs,{headers:{authorization:'Bearer job-secret'}});
 assert.equal(r.code,200);
 assert.equal(r.data.processed,1);
 assert.equal(r.data.results[0].status,'sent');
 assert.equal(calls.filter(c=>c.url.includes('/rest/v1/email_jobs?id=eq.job-1')).length,2);
 assert.ok(!JSON.stringify(r.data).includes('brevo-secret'));
 assert.ok(!JSON.stringify(r.data).includes('service-secret'));
});
test('processador de email_jobs exige segredo em produção',async()=>{
 process.env.VERCEL_ENV='production';
 const r=await callApi(processEmailJobs);
 assert.equal(r.code,503);
 assert.match(r.data.erro,/EMAIL_JOBS_SECRET/);
});
test('Vercel aplica cabeçalhos que protegem checkout e integrações necessárias',()=>{
 const config=JSON.parse(fs.readFileSync('vercel.json','utf8'));
 assert.equal(config.crons,undefined);
 const all=config.headers.flatMap(rule=>rule.headers);
 const header=key=>all.find(item=>item.key===key)?.value||'';
 const csp=header('Content-Security-Policy');
 for(const directive of ["base-uri 'self'","object-src 'none'","frame-ancestors 'self'","form-action 'self'","https://connect.facebook.net","https://www.clarity.ms","https://viacep.com.br","https://cdn.converteai.net","worker-src 'self' blob:"])assert.match(csp,new RegExp(directive.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 assert.match(csp,/https:\/\/cdn\.utmify\.com\.br/);
 assert.equal(header('X-Frame-Options'),'DENY');
 assert.match(header('Strict-Transport-Security'),/max-age=/);
 assert.equal(header('X-Content-Type-Options'),'nosniff');
 assert.equal(header('Referrer-Policy'),'strict-origin-when-cross-origin');
});
test('preço calculado pelo servidor e total adulterado rejeitado',()=>{setup();assert.equal(p.total(body()),14.9);assert.equal(p.total({...body(),addon_colorir:true,addon_expressa:true,obExtras:true}),36.6);assert.throws(()=>p.buildOrder({...body(),total:0.01},'pix',{}),/preço/)});
test('credenciais ausentes resultam em JSON 503, sem chamada ao gateway',async()=>{
 global.fetch=()=>{throw Error('Não deveria chamar')};const r=await call(pix,body());assert.equal(r.code,503);assert.match(r.data.erro,/AMPLO_PUBLIC_KEY/);
});
test('Pix: payload correto, resposta normalizada e sem chave secreta',async()=>{
 setup();global.fetch=async(url,options)=>{assert.equal(url,'https://app.amplopay.com/api/v1/gateway/pix/receive');assert.equal(options.headers['x-secret-key'],'test-secret');const o=JSON.parse(options.body);assert.equal(o.amount,14.9);assert.equal(o.client.name,'Responsável');assert.equal(o.products[0].price,o.amount);return new Response(JSON.stringify({transactionId:'tx1',status:'OK',webhookToken:'private',pix:{code:'000201abc',image:'https://example.com/qr.png'}}))};
 const r=await call(pix,body());assert.equal(r.code,200);assert.equal(r.data.status,'pending');assert.equal(r.data.qr_code,'000201abc');assert.equal(p.verify(r.data.statusToken).id,'tx1');assert.ok(!JSON.stringify(r.data).includes('test-secret'));assert.ok(!JSON.stringify(r.data).includes('private'));
});
test('Utmify: script de UTMs fica instalado sem postback duplicado no backend',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/Utmify UTMs script/);
 assert.match(html,/DFASknEsAKoezPt18Csw5wNAIpA8pI8BgCMovV5PZMQwuY8YmTZrvBJDbYR8vtQG/);
 assert.doesNotMatch(fs.readFileSync('api/criar-pix.js','utf8'),/api\.utmify|utmify/);
 assert.doesNotMatch(fs.readFileSync('api/criar-cartao.js','utf8'),/api\.utmify|utmify/);
 assert.doesNotMatch(fs.readFileSync('api/status.js','utf8'),/api\.utmify|utmify/);
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
test('cobranças não são bloqueadas por limite local de tentativas',async()=>{
 setup();let gatewayCalls=0;
 global.fetch=async()=>{gatewayCalls++;return new Response(JSON.stringify({transactionId:'rate-'+gatewayCalls,status:'OK',pix:{code:'000201'}}))};
 for(let attempt=0;attempt<12;attempt++)assert.equal((await call(pix,body())).code,200);
 assert.equal(gatewayCalls,12);
});
test('ícone Pix referenciado usa extensão correspondente ao PNG',()=>{
 const html=fs.readFileSync('index.html','utf8');assert.ok(!html.includes('images/pix.svg'));assert.ok((html.match(/images\/pix.png/g)||[]).length>=3);assert.equal(fs.readFileSync('images/pix.png').subarray(0,8).toString('hex'),'89504e470d0a1a0a');
});
test('16 combinações de desconto e adicionais: UI, total e itens da operadora coincidem',()=>{
 setup();const html=fs.readFileSync('index.html','utf8');
 const source=html.match(/const PRICES = .*?;/)[0]+'\n'+html.match(/function calcTotal\(\)\{[\s\S]*?\n\}/)[0]+'\n'+html.match(/function calcTotalCheckout\(\)\{[\s\S]*?\n\}/)[0];
 for(let mask=0;mask<16;mask++){
   const b={...body(),hasDiscount:!!(mask&1),addon_colorir:!!(mask&2),addon_expressa:!!(mask&4),obExtras:!!(mask&8)};
   const ctx={hasDiscount:b.hasDiscount,checkoutRecoveryOffer:false,checkoutMode:'main',upsellDownsellActive:false,addons:{colorir:b.addon_colorir,expressa:b.addon_expressa},obExtras:b.obExtras,OB_PRECO:9.9};vm.createContext(ctx);vm.runInContext(source,ctx);
   b.total=vm.runInContext('calcTotalCheckout()',ctx);const order=p.buildOrder(b,'pix',{});
   assert.equal(order.amount,b.total);assert.equal(order.products.reduce((sum,item)=>sum+Math.round(item.price*100)*item.quantity,0),Math.round(b.total*100));
   assert.equal(order.products.length,1+Number(b.addon_colorir)+Number(b.addon_expressa)+Number(b.obExtras));assert.equal(order.metadata.obExtras,b.obExtras);
 }
});
test('CPF/CNPJ validado, formatado e enviado para ambos os métodos',()=>{
 setup();const v=require('../js/document');assert.ok(v.valid('529.982.247-25'));assert.ok(v.valid('11.222.333/0001-81'));
 for(const d of ['', '11111111111','52998224724','11222333000180','52998224725abc'])assert.equal(v.valid(d),false);
 assert.equal(p.buildOrder(body(),'pix',{}).client.document,'52998224725');
 assert.equal(p.buildOrder({...body(),document:undefined,client:{document:'11.222.333/0001-81'}},'pix',{}).client.document,'11222333000181');
});
test('documento ausente bloqueia cobrança antes de chamar a operadora',async()=>{
 setup();let called=false;global.fetch=async()=>{called=true;throw Error('Não deveria chamar')};
 const r=await call(pix,{...body(),document:''});assert.equal(r.code,400);assert.match(r.data.erro,/CPF ou CNPJ/);assert.equal(called,false);
});
test('telefone nacional é enviado com DDD sem prefixo 55 duplicado',()=>{setup();assert.equal(p.buildOrder(body(),'pix',{}).client.phone,'11999999999')});
test('mostra código e campo recusado sem expor dados do comprador ou credenciais',async()=>{
 setup();global.fetch=async()=>new Response(JSON.stringify({errorCode:'GATEWAY_INVALID_DATA',message:'Dados inválidos',details:[{path:'client.phone',error:{message:'Invalid phone 5511999999999 for teste@example.com test-secret test-public'}}]}),{status:400});
 const r=await call(pix,body());assert.equal(r.code,422);assert.match(r.data.erro,/GATEWAY_INVALID_DATA/);assert.match(r.data.erro,/client.phone/);for(const value of ['5511999999999','teste@example.com','test-secret','test-public'])assert.ok(!r.data.erro.includes(value));
});
test('recusa HTTP 200 preserva motivo e falha 500 bloqueia repetição ambígua',async()=>{
 setup();global.fetch=async()=>new Response(JSON.stringify({status:'REJECTED',errorDescription:'ACQUIRER_REJECTED'}));assert.match((await call(pix,body())).data.erro,/ACQUIRER_REJECTED/);
 global.fetch=async()=>new Response(JSON.stringify({message:'Unavailable'}),{status:500});assert.equal((await call(pix,body())).data.uncertain,true);
});
