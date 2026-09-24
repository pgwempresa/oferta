const {test, afterEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {pixGenerated}=require('../lib/meta');
const originalFetch=global.fetch;
afterEach(()=>{global.fetch=originalFetch;delete process.env.META_ACCESS_TOKEN;});
const req={headers:{origin:'https://loja.example','user-agent':'test-agent'}};
const order={amount:36.6,client:{email:'Adult@example.com',document:'do-not-share'}};
test('CAPI sem token não bloqueia Pix; ID estável por transação',async()=>{
 global.fetch=()=>{throw Error('Unexpected fetch')};
 const id=await pixGenerated(req,{},order,'tx1');
 assert.equal(id,await pixGenerated(req,{},order,'tx1'));
 assert.notEqual(id,await pixGenerated(req,{},order,'tx2'));
});
test('CAPI Purchase ao gerar Pix: valor real, sem dados infantis/CPF, e-mail hash e token só no header',async()=>{
 process.env.META_ACCESS_TOKEN='test-only-secret';
 let event;
 global.fetch=async(url,options)=>{
  assert.equal(url,'https://graph.facebook.com/v23.0/2175744060029065/events');
  assert.equal(options.headers.Authorization,'Bearer test-only-secret');
  assert.ok(!options.body.includes('test-only-secret'));
  assert.ok(!options.body.includes('Adult@'));
  assert.ok(!options.body.includes('do-not-share'));
  event=JSON.parse(options.body).data[0];return new Response('{}');
 };
 const id=await pixGenerated(req,{quizData:{child_name:'do-not-share'},document:'do-not-share'},order,'tx1');
 assert.equal(event.event_id,id);assert.equal(event.event_name,'Purchase');
 assert.equal(event.custom_data.value,36.6);assert.equal(event.custom_data.currency,'BRL');
 assert.equal(event.custom_data.payment_status,'pending');assert.match(event.user_data.em[0],/^[a-f0-9]{64}$/);
});
test('falha da Meta não transforma Pix criado em erro',async()=>{
 process.env.META_ACCESS_TOKEN='test-only-secret';
 global.fetch=async()=>{throw Error('timeout')};
 assert.match(await pixGenerated(req,{},order,'tx1'),/^pix_/);
 global.fetch=async()=>new Response('{}',{status:401});
 assert.match(await pixGenerated(req,{},order,'tx1'),/^pix_/);
});
test('pixel navegador: ID e valor do servidor; repetições e storage bloqueado seguros',()=>{
 const calls=[];const context={window:{fbq:(...args)=>calls.push(args)},sessionStorage:{getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}}};
 vm.runInNewContext(fs.readFileSync('js/meta-pixel.js','utf8'),context);
 const data={metaEventId:'pix_tx1',total:36.6};context.window.trackPixPurchase(data);context.window.trackPixPurchase(data);
 const purchases=calls.filter(c=>c[1]==='Purchase');assert.equal(purchases.length,1);
 assert.equal(purchases[0][2].value,36.6);assert.equal(purchases[0][3].eventID,data.metaEventId);
});
test('HTML inclui o código base inline detectável pela Meta',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/connect\.facebook\.net\/en_US\/fbevents\.js/);
 assert.match(html,/fbq\('init','2175744060029065'\)/);
 assert.match(html,/fbq\('track','PageView'\)/);
});
