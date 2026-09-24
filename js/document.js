(function(root){
  'use strict';
  function normalize(value){return String(value||'').replace(/[.\-\/\s]/g,'');}
  function valid(value){
    const doc=normalize(value);
    if(!/^(?:\d{11}|\d{14})$/.test(doc)||/^(\d)\1+$/.test(doc))return false;
    const cpf=doc.length===11;
    function digit(size){
      let sum=0,weight=cpf?size+1:size-7;
      for(let i=0;i<size;i++){sum+=Number(doc[i])*weight;weight--;if(!cpf&&weight<2)weight=9;}
      const remainder=sum%11;return remainder<2?0:11-remainder;
    }
    const size=cpf?9:12;return digit(size)===Number(doc[size])&&digit(size+1)===Number(doc[size+1]);
  }
  const api={normalize,valid};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BuyerDocument=api;
})(typeof window==='object'?window:globalThis);
