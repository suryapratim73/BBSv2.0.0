const http = require("http");

module.exports = function(ctx){
    let { version } = ctx?.packager.appInfo || {};
    let req = http.request({
        hostname:"127.0.0.1",
        path:`/upload/version=${version}`,
        method:"POST",
        port:3030,
        protocol:"http:"
    },res=>{
        res.addListener("data",(data)=>{
            console.log({msg:"Response from update server"})
            console.log(JSON.parse(data.toString()))
        })
    });
    req.on("error",err=>{
        console.log({err})
    });
    req.write("");
}