const p=require('../lib/payment');
const recovery=require('../lib/recovery');

module.exports=p.route('POST',async req=>{
  return recovery.record(p.input(req));
});
