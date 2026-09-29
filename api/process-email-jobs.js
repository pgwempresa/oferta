const emailJobs=require('../lib/email-jobs');

module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'&&req.method!=='POST'){
    res.setHeader('Allow','GET, POST');
    return res.status(405).json({erro:'Método não permitido.'});
  }
  const secret=process.env.EMAIL_JOBS_SECRET?.trim()||process.env.CRON_SECRET?.trim();
  const auth=String(req.headers.authorization||'');
  const token=auth.startsWith('Bearer ')?auth.slice(7):String(req.query?.secret||'');
  if(secret&&token!==secret)return res.status(401).json({erro:'Não autorizado.'});
  if(!secret&&process.env.VERCEL_ENV==='production')return res.status(503).json({erro:'Configure EMAIL_JOBS_SECRET antes de ativar os envios.'});
  try{
    const limit=Math.min(20,Math.max(1,Number(req.query?.limit||10)));
    return res.status(200).json(await emailJobs.processJobs(req,limit));
  }catch(error){
    return res.status(500).json({erro:error?.message||'Não foi possível processar os e-mails.'});
  }
};
