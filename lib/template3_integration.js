// ==================== INTEGRATION CODE ====================
// Add this to makePDF.default.js after the default2 template section

// Around line 91, after the default2 block, add this:

if("billTemplate" in saleConfig && saleConfig.billTemplate.applyTemplate===false && saleConfig.billTemplate.file==="default3"){
    for(let x=0;x<captions.length;x++){
        let caption = captions[x];
        myEmitter.emit("newPage",caption);
        let { width } = doc.page;
        let headerEndY = createHeader3(doc,billMeta,customer,caption);
        doc.y = headerEndY;
        topY = doc.y;
        bottomY = createFooter3(doc,billMeta,customer,margin);
        
        await applyEmblem(100,30,saleConfig,doc,width/2,topY+20);
        
        for(let i=0;i<orderItems.length;i++){
            let itemObj = orderItems[i];
            createBody3(doc,itemObj,i+1,factor);
            if(doc.y+2*doc.currentLineHeight()>=bottomY-10){
                myEmitter.emit("newPage",caption);
                headerEndY = createHeader3(doc,billMeta,customer,caption);
                doc.y = headerEndY;
                topY = doc.y;
                bottomY = createFooter3(doc,billMeta,customer,margin);
                await applyEmblem(100,30,saleConfig,doc,width/2,topY+20);
            }
        }
    }
    doc.save().end();
    return pdfPath;
}

// ==================== HOW TO USE ====================
// In your saleConfig.json, set:
// "billTemplate": {
//     "applyTemplate": false,
//     "file": "default3",
//     "applyEmblem": false,
//     "applySeal": false
// }
