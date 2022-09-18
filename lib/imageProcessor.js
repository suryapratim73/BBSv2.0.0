const { ipcRenderer } = require("electron");
ipcRenderer.on("process-image",(e,buffData,opacity=0.5)=>{
    let base64Img = Buffer.from(buffData).toString("base64");
    let canv = document.createElement("canvas");
    let ctx = canv.getContext("2d");
    let img = document.createElement("img");
    img.src = `data:image/png;base64,${base64Img}`;
    img.onload = function(){
        canv.width = this.width;
        canv.height = this.height;
        ctx.globalAlpha = opacity;
        ctx.drawImage(img,0,0);
        ipcRenderer.send("processed-image",canv.toDataURL("image/png"));
    };
})