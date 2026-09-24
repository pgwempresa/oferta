module.exports=(req,res)=>{res.setHeader('Cache-Control','no-store');res.status(200).json({orderBump:{preco:9.90},maxParcelas:1});};
