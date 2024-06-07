const http = require("http");

module.exports = function(ctx){
    let { version } = ctx.packager.appInfo || {};
    let req = http.request({
        hostname:"code.mbtcverse.com",
        path:`/upload/version=${version}`,
        method:"POST",
        port:80,
        protocol:"http:"
    },res=>{
        res.addListener("data",(data)=>{
            console.log({msg:"afterpack.js:Response from update server"})
            console.log(data.toString())
        })
    });
    req.on("error",err=>{
        console.log({file:"afterpackjs",err})
    });
    req.write("");
}