'use strict';

const VALID_EMAIL=/^\S+@\S+\.\S+$/;
const STATUS_RANK={checkout_started:1,abandoned:2,pix_generated:3,card_attempted:3,paid:4};

function text(value,max=180){return typeof value==='string'?value.trim().slice(0,max):''}
function money(value){const n=Number(value);return Number.isFinite(n)?Math.round(n*100)/100:0}
function addMinutes(minutes){return new Date(Date.now()+minutes*60000).toISOString()}
function env(){const url=process.env.SUPABASE_URL?.trim()?.replace(/\/+$/,'');const key=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();return url&&key?{url,key}:null}

async function supabaseRequest(cfg,path,options={}){
  const response=await fetch(cfg.url+path,{...options,headers:{apikey:cfg.key,Authorization:'Bearer '+cfg.key,'Content-Type':'application/json',Prefer:'return=representation',...(options.headers||{})},signal:AbortSignal.timeout(5000)});
  const raw=await response.text();let data=null;
  if(raw)try{data=JSON.parse(raw)}catch{data=raw}
  if(!response.ok)throw new Error('Supabase HTTP '+response.status);
  return data;
}

function mapStatus(inputStatus,paymentMethod){
  if(inputStatus==='paid')return 'paid';
  if(inputStatus==='pix_pending'||inputStatus==='pix_created')return 'pix_generated';
  if(paymentMethod==='card')return 'card_attempted';
  if(inputStatus==='checkout_opened'||inputStatus==='email_captured')return 'checkout_started';
  return 'checkout_started';
}

function normalize(input){
  const quiz=input.quizData&&typeof input.quizData==='object'&&!Array.isArray(input.quizData)?input.quizData:{};
  const email=text(input.email||quiz.email,180).toLowerCase();
  if(!VALID_EMAIL.test(email))return null;
  const paymentMethod=text(input.payment_method,20)==='card'?'card':text(input.payment_method,20)==='pix'?'pix':null;
  const sessionKey=text(input.session_id||input.identifier||input.eventId||email,220);
  const status=mapStatus(input.status,paymentMethod);
  return {
    session_key:sessionKey,
    guardian_name:text(input.responsible_name||quiz.mom_name||input.name,180),
    child_name:text(input.child_name||quiz.child_name_full||quiz.child_name,120),
    email,
    phone:text(input.phone||input.telefone,40),
    quiz_data:quiz,
    cart_data:{
      checkout_step:text(input.checkout_step||input.step,80),
      checkout_mode:text(input.checkout_mode,40),
      checkout_recovery_offer:input.checkout_recovery_offer===true,
      upsell_familiar:input.upsell_familiar===true,
      upsell_downsell:input.upsell_downsell===true,
      pix_code:text(input.pix_code,2000),
      pix_image:text(input.pix_image,1000),
      pix_expires_at:text(input.pix_expires_at,80),
      status_token:text(input.status_token,1000),
      recovery_token:text(input.recovery_token,1000),
      utms:input.utms&&typeof input.utms==='object'?input.utms:{}
    },
    amount:money(input.amount||input.total),
    status,
    payment_method:paymentMethod,
    gateway_transaction_id:text(input.payment_id,120)||null,
    pix_generated_at:status==='pix_generated'?new Date().toISOString():null,
    paid_at:status==='paid'?new Date().toISOString():null,
    recovery_paused:status==='paid'
  };
}

async function findLead(cfg,sessionKey,email){
  let rows=await supabaseRequest(cfg,'/rest/v1/checkout_leads?select=id,status&session_key=eq.'+encodeURIComponent(sessionKey)+'&limit=1',{method:'GET',headers:{Prefer:''}});
  if(Array.isArray(rows)&&rows[0])return rows[0];
  rows=await supabaseRequest(cfg,'/rest/v1/checkout_leads?select=id,status&email=eq.'+encodeURIComponent(email)+'&order=created_at.desc&limit=1',{method:'GET',headers:{Prefer:''}});
  return Array.isArray(rows)?rows[0]:null;
}

function jobsFor(status){
  if(status==='pix_generated')return [{kind:'pix_reminder',scheduled_for:addMinutes(5)},{kind:'last_chance',scheduled_for:addMinutes(120)}];
  if(status==='checkout_started'||status==='abandoned')return [{kind:'checkout_reminder',scheduled_for:addMinutes(15)}];
  return [];
}

async function cancelJobs(cfg,leadId){
  await supabaseRequest(cfg,'/rest/v1/email_jobs?lead_id=eq.'+encodeURIComponent(leadId)+'&status=eq.scheduled',{method:'PATCH',body:JSON.stringify({status:'cancelled'})});
}

async function cancelJobKind(cfg,leadId,kind){
  await supabaseRequest(cfg,'/rest/v1/email_jobs?lead_id=eq.'+encodeURIComponent(leadId)+'&kind=eq.'+encodeURIComponent(kind)+'&status=eq.scheduled',{method:'PATCH',body:JSON.stringify({status:'cancelled'})});
}

async function upsertJob(cfg,leadId,job){
  await supabaseRequest(cfg,'/rest/v1/email_jobs?on_conflict=lead_id,kind',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({lead_id:leadId,kind:job.kind,scheduled_for:job.scheduled_for,status:'scheduled'})});
}

async function scheduleJobs(cfg,leadId,status){
  if(status==='paid'){await cancelJobs(cfg,leadId);return}
  if(status==='pix_generated')await cancelJobKind(cfg,leadId,'checkout_reminder');
  for(const job of jobsFor(status))await upsertJob(cfg,leadId,job);
}

async function record(input){
  try{
    const cfg=env();
    if(!cfg)return {ok:true,skipped:true,reason:'not_configured'};
    const row=normalize(input||{});
    if(!row)return {ok:true,skipped:true,reason:'invalid_email'};
    const latest=await findLead(cfg,row.session_key,row.email);
    let leadId=latest?.id;
    if(leadId){
      if((STATUS_RANK[latest.status]||0)>(STATUS_RANK[row.status]||0))row.status=latest.status;
      const patch={...row};delete patch.session_key;
      if(!patch.gateway_transaction_id)delete patch.gateway_transaction_id;
      if(!patch.pix_generated_at)delete patch.pix_generated_at;
      if(!patch.paid_at)delete patch.paid_at;
      await supabaseRequest(cfg,'/rest/v1/checkout_leads?id=eq.'+encodeURIComponent(leadId),{method:'PATCH',body:JSON.stringify(patch)});
    }else{
      const inserted=await supabaseRequest(cfg,'/rest/v1/checkout_leads',{method:'POST',body:JSON.stringify(row)});
      leadId=Array.isArray(inserted)&&inserted[0]?.id;
    }
    if(leadId)try{await scheduleJobs(cfg,leadId,row.status)}catch(error){console.warn('[recovery] jobs não agendados:', error?.message||error)}
    return {ok:true,lead_id:leadId};
  }catch(error){
    console.warn('[recovery] evento não registrado:', error?.message||error);
    return {ok:false,skipped:true};
  }
}

module.exports={record,normalize,jobsFor};
