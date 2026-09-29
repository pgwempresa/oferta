'use strict';

function text(value,max=240){return typeof value==='string'?value.trim().slice(0,max):''}
function supabaseEnv(){const url=process.env.SUPABASE_URL?.trim()?.replace(/\/+$/,'');const key=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();if(!url||!key)throw new Error('Supabase não configurado.');return {url,key}}
function brevoEnv(){const key=process.env.BREVO_API_KEY?.trim();const email=process.env.BREVO_FROM_EMAIL?.trim();const name=process.env.BREVO_FROM_NAME?.trim()||'Sua Historinha';if(!key||!email)throw new Error('Brevo não configurado.');return {key,email,name}}

async function supabaseRequest(path,options={}){
  const cfg=supabaseEnv();
  const response=await fetch(cfg.url+path,{...options,headers:{apikey:cfg.key,Authorization:'Bearer '+cfg.key,'Content-Type':'application/json',Prefer:'return=representation',...(options.headers||{})},signal:AbortSignal.timeout(10000)});
  const raw=await response.text();let data=null;
  if(raw)try{data=JSON.parse(raw)}catch{data=raw}
  if(!response.ok)throw new Error('Supabase HTTP '+response.status);
  return data;
}
function siteUrl(req){const configured=process.env.PUBLIC_SITE_URL?.trim()?.replace(/\/+$/,'');if(configured)return configured;if(process.env.VERCEL_URL)return 'https://'+process.env.VERCEL_URL;return req?.headers?.host?'https://'+req.headers.host:''}
function firstName(name){return text(name,80).split(/\s+/)[0]||''}

function template(job,req){
  const lead=job.checkout_leads||{};
  const cart=lead.cart_data&&typeof lead.cart_data==='object'?lead.cart_data:{};
  const child=firstName(lead.child_name)||'seu pequeno';
  const url=siteUrl(req);
  const recoveryUrl=url&&cart.recovery_token?`${url}/recuperar-pix.html?token=${encodeURIComponent(cart.recovery_token)}`:url;
  const link=recoveryUrl?`<p style="margin:22px 0"><a href="${recoveryUrl}" style="background:#04aa3f;color:#fff;text-decoration:none;padding:14px 20px;border-radius:12px;font-weight:800;display:inline-block">Voltar para finalizar</a></p>`:'';
  const baseStyle='font-family:Arial,sans-serif;color:#242441;line-height:1.5;font-size:16px';
  const wrapStart=`<div style="${baseStyle};max-width:560px;margin:0 auto;padding:20px">`;
  const wrapEnd='<p style="font-size:12px;color:#777;margin-top:26px">Você recebeu este e-mail porque começou a criar uma historinha personalizada.</p></div>';
  const templates={
    checkout_reminder:{subject:`A historinha de ${child} ficou esperando por você`,body:`${wrapStart}<h2 style="margin:0 0 12px">A historinha de ${child} ainda não foi finalizada</h2><p>Você começou a criar a historinha, mas não terminou o pedido.</p><p>Se quiser continuar, é só voltar e finalizar em poucos minutos.</p>${link}${wrapEnd}`},
    pix_reminder:{subject:`Seu Pix da historinha de ${child} está aguardando pagamento`,body:`${wrapStart}<h2 style="margin:0 0 12px">Falta só pagar o Pix</h2><p>Seu pedido foi criado, mas o pagamento ainda não apareceu como confirmado.</p><p>Abra o aplicativo do banco e pague o Pix gerado na tela do pedido.</p>${link}${wrapEnd}`},
    last_chance:{subject:`Último lembrete sobre a historinha de ${child}`,body:`${wrapStart}<h2 style="margin:0 0 12px">Último lembrete</h2><p>O pagamento da historinha de ${child} ainda não foi confirmado.</p><p>Se ainda quiser receber, volte ao site e finalize o pedido.</p>${link}${wrapEnd}`}
  };
  return templates[job.kind]||null;
}

async function sendBrevo(job,req){
  const cfg=brevoEnv();
  const view=template(job,req);
  if(!view)throw new Error('Template não encontrado.');
  const to=text(job.checkout_leads?.email,180).toLowerCase();
  if(!/^\S+@\S+\.\S+$/.test(to))throw new Error('E-mail inválido no lead.');
  const response=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'Content-Type':'application/json','api-key':cfg.key},body:JSON.stringify({sender:{email:cfg.email,name:cfg.name},to:[{email:to}],subject:view.subject,htmlContent:view.body}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Brevo HTTP '+response.status);
}

async function markJob(id,status,error){
  const body={status};
  if(status==='sent')body.sent_at=new Date().toISOString();
  if(error)body.error_message=text(error,500);
  await supabaseRequest('/rest/v1/email_jobs?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify(body)});
}
async function dueJobs(limit=10){
  const now=encodeURIComponent(new Date().toISOString());
  const query='/rest/v1/email_jobs?select=id,kind,status,scheduled_for,attempts,checkout_leads(email,child_name,guardian_name,amount,status,cart_data)&status=eq.scheduled&scheduled_for=lte.'+now+'&order=scheduled_for.asc&limit='+Number(limit||10);
  const rows=await supabaseRequest(query,{method:'GET',headers:{Prefer:''}});
  return Array.isArray(rows)?rows:[];
}
async function processJobs(req,limit=10){
  const jobs=await dueJobs(limit);
  const results=[];
  for(const job of jobs){
    try{
      await markJob(job.id,'processing');
      await sendBrevo(job,req);
      await markJob(job.id,'sent');
      results.push({id:job.id,status:'sent',kind:job.kind});
    }catch(error){
      await markJob(job.id,'failed',error?.message||String(error));
      results.push({id:job.id,status:'failed',kind:job.kind,error:error?.message||String(error)});
    }
  }
  return {ok:true,processed:results.length,results};
}
module.exports={processJobs,template,dueJobs};
