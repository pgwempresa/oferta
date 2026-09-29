'use strict';

const VALID_EMAIL=/^\S+@\S+\.\S+$/;
const ALLOWED_STATUS=new Set(['email_captured','checkout_opened','pix_created','pix_pending','paid','expired','abandoned_checkout']);
const STATUS_RANK={email_captured:1,checkout_opened:2,abandoned_checkout:3,pix_created:4,pix_pending:4,expired:5,paid:6};

function text(value,max=160){
  return typeof value==='string'?value.trim().slice(0,max):'';
}

function money(value){
  const n=Number(value);
  return Number.isFinite(n)?Math.round(n*100)/100:null;
}

function env(){
  const url=process.env.SUPABASE_URL?.trim()?.replace(/\/+$/,'');
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return url&&key?{url,key}:null;
}

function pickUtm(input,key){
  return text(input?.utms?.[key]||input?.[key],180);
}

function normalize(input){
  const quiz=input.quizData&&typeof input.quizData==='object'&&!Array.isArray(input.quizData)?input.quizData:{};
  const email=text(input.email||quiz.email,180).toLowerCase();
  if(!VALID_EMAIL.test(email))return null;
  const status=ALLOWED_STATUS.has(input.status)?input.status:'email_captured';
  return {
    email,
    phone:text(input.phone||input.telefone,40),
    responsible_name:text(input.responsible_name||quiz.mom_name||input.name,180),
    child_name:text(input.child_name||quiz.child_name_full||quiz.child_name,120),
    status,
    checkout_step:text(input.checkout_step||input.step,80),
    payment_method:text(input.payment_method,40),
    payment_id:text(input.payment_id,120),
    status_token:text(input.status_token,1000),
    amount:money(input.amount||input.total),
    utm_source:pickUtm(input,'utm_source'),
    utm_medium:pickUtm(input,'utm_medium'),
    utm_campaign:pickUtm(input,'utm_campaign'),
    utm_content:pickUtm(input,'utm_content'),
    utm_term:pickUtm(input,'utm_term'),
    metadata:{
      session_id:text(input.session_id||input.identifier||input.eventId,160),
      checkout_mode:text(input.checkout_mode,40),
      checkout_recovery_offer:input.checkout_recovery_offer===true,
      upsell_familiar:input.upsell_familiar===true,
      upsell_downsell:input.upsell_downsell===true,
      source:'site'
    }
  };
}

async function supabaseRequest(cfg,path,options={}){
  const response=await fetch(cfg.url+path,{
    ...options,
    headers:{
      apikey:cfg.key,
      Authorization:'Bearer '+cfg.key,
      'Content-Type':'application/json',
      Prefer:'return=representation',
      ...(options.headers||{})
    },
    signal:AbortSignal.timeout(5000)
  });
  const raw=await response.text();
  let data=null;
  if(raw)try{data=JSON.parse(raw)}catch{data=raw}
  if(!response.ok)throw new Error('Supabase HTTP '+response.status);
  return data;
}

async function findLatest(cfg,email){
  const query='/rest/v1/checkout_recovery?select=id,status&email=eq.'+encodeURIComponent(email)+'&order=created_at.desc&limit=1';
  const rows=await supabaseRequest(cfg,query,{method:'GET',headers:{Prefer:''}});
  return Array.isArray(rows)?rows[0]:null;
}

function addMinutes(minutes){
  return new Date(Date.now()+minutes*60000).toISOString();
}

function jobPlan(status){
  if(status==='pix_pending'||status==='pix_created')return [
    {job_type:'pix_pending_10m',scheduled_at:addMinutes(10)},
    {job_type:'pix_pending_2h',scheduled_at:addMinutes(120)},
    {job_type:'pix_pending_24h',scheduled_at:addMinutes(1440)}
  ];
  if(status==='email_captured'||status==='checkout_opened'||status==='abandoned_checkout')return [
    {job_type:'cart_abandoned_15m',scheduled_at:addMinutes(15)},
    {job_type:'cart_abandoned_2h',scheduled_at:addMinutes(120)}
  ];
  return [];
}

async function cancelPendingJobs(cfg,recoveryId){
  if(!recoveryId)return;
  await supabaseRequest(cfg,'/rest/v1/email_jobs?recovery_id=eq.'+encodeURIComponent(recoveryId)+'&status=eq.pending',{
    method:'PATCH',
    body:JSON.stringify({status:'canceled'})
  });
}

async function hasPendingJob(cfg,recoveryId,jobType){
  const query='/rest/v1/email_jobs?select=id&recovery_id=eq.'+encodeURIComponent(recoveryId)+'&job_type=eq.'+encodeURIComponent(jobType)+'&status=eq.pending&limit=1';
  const rows=await supabaseRequest(cfg,query,{method:'GET',headers:{Prefer:''}});
  return Array.isArray(rows)&&rows.length>0;
}

async function scheduleJobs(cfg,recoveryId,row){
  if(!recoveryId)return;
  if(row.status==='paid'){
    await cancelPendingJobs(cfg,recoveryId);
    return;
  }
  const jobs=jobPlan(row.status);
  for(const job of jobs){
    if(await hasPendingJob(cfg,recoveryId,job.job_type))continue;
    await supabaseRequest(cfg,'/rest/v1/email_jobs',{
      method:'POST',
      body:JSON.stringify({
        recovery_id:recoveryId,
        email:row.email,
        job_type:job.job_type,
        status:'pending',
        scheduled_at:job.scheduled_at,
        payload:{
          email:row.email,
          responsible_name:row.responsible_name,
          child_name:row.child_name,
          amount:row.amount,
          payment_method:row.payment_method,
          payment_id:row.payment_id,
          status_token:row.status_token,
          checkout_step:row.checkout_step,
          metadata:row.metadata
        }
      })
    });
  }
}

async function record(input){
  try{
    const cfg=env();
    if(!cfg)return {ok:true,skipped:true,reason:'not_configured'};
    const row=normalize(input||{});
    if(!row)return {ok:true,skipped:true,reason:'invalid_email'};

    const latest=await findLatest(cfg,row.email);
    if(latest?.id){
      if((STATUS_RANK[latest.status]||0)>(STATUS_RANK[row.status]||0))row.status=latest.status;
      await supabaseRequest(cfg,'/rest/v1/checkout_recovery?id=eq.'+encodeURIComponent(latest.id),{method:'PATCH',body:JSON.stringify(row)});
      try{await scheduleJobs(cfg,latest.id,row)}catch(error){console.warn('[recovery] jobs não agendados:', error?.message || error)}
      return {ok:true,updated:true};
    }

    const inserted=await supabaseRequest(cfg,'/rest/v1/checkout_recovery',{method:'POST',body:JSON.stringify(row)});
    const recoveryId=Array.isArray(inserted)&&inserted[0]?.id;
    try{await scheduleJobs(cfg,recoveryId,row)}catch(error){console.warn('[recovery] jobs não agendados:', error?.message || error)}
    return {ok:true,created:true};
  }catch(error){
    console.warn('[recovery] evento não registrado:', error?.message || error);
    return {ok:false,skipped:true};
  }
}

module.exports={record,normalize,jobPlan};
