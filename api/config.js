module.exports=(req,res)=>{res.setHeader('Cache-Control','no-store');res.status(200).json({orderBump:{preco:9.90},orderBumps:{cartinha:6.90,bau:7.90},maxParcelas:1});};
