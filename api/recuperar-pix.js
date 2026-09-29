const p=require('../lib/payment');

function supabaseEnv(){
  const url=process.env.SUPABASE_URL?.trim()?.replace(/\/+$/,'');
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if(!url||!key)throw new p.PaymentError('Recuperação indisponível agora.',503);
  return {url,key};
}

async function supabaseRequest(path,options={}){
  const cfg=supabaseEnv();
  const response=await fetch(cfg.url+path,{...options,headers:{apikey:cfg.key,Authorization:'Bearer '+cfg.key,'Content-Type':'application/json',Prefer:'return=representation',...(options.headers||{})},signal:AbortSignal.timeout(8000)});
  const raw=await response.text();let data=null;
  if(raw)try{data=JSON.parse(raw)}catch{data=raw}
  if(!response.ok)throw new p.PaymentError('Recuperação indisponível agora.',503);
  return data;
}

module.exports=p.route('POST',async req=>{
  const body=p.input(req);
  const t=p.verifyRecovery(body.token);
  const rows=await supabaseRequest('/rest/v1/checkout_leads?select=email,child_name,amount,status,cart_data&gateway_transaction_id=eq.'+encodeURIComponent(t.id)+'&limit=1',{method:'GET',headers:{Prefer:''}});
  const lead=Array.isArray(rows)?rows[0]:null;
  if(!lead)throw new p.PaymentError('Pix não encontrado.',404);
  const cart=lead.cart_data&&typeof lead.cart_data==='object'?lead.cart_data:{};
  if(!cart.pix_code)throw new p.PaymentError('Código Pix não encontrado.',404);
  return {
    email:lead.email,
    childName:lead.child_name,
    amount:lead.amount,
    status:lead.status,
    pixCode:cart.pix_code,
    pixImage:cart.pix_image,
    pixExpiresAt:cart.pix_expires_at,
    statusToken:cart.status_token
  };
});
