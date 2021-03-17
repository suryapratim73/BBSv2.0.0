const { ipcRenderer } = require("electron");
const {toggleDevTool} = require("../js/common");

toggleDevTool(document);

let tbody = document.querySelector("tbody");
let ths = document.querySelectorAll("#contact-div th");
let cover = document.querySelector(".cover");
let modal = document.querySelector(".modal");
let modalThs = document.querySelectorAll(".modal th");
let modalTbody = document.querySelector(".modal tbody");
let modalHeader = document.querySelector(".modal header");
let modalFooter = document.querySelector(".modal footer");

function closeModal(){
    modal.classList.add("hide");
    cover.classList.add("hide");
}

cover.addEventListener("click",closeModal);

ipcRenderer.on("supplier-ledger-detail",async (e,{fullLedger,id,name})=>{
    if(tbody.children.length===0)
        fullLedger.forEach(entry=>{
            let {paymentStatus,itemList} = entry;
            let tr = document.createElement("tr");
            tr.dataset.itemList = itemList;
            ths.forEach(th=>{
                let td = document.createElement("td");
                td.textContent = th.dataset.name!=="date"? entry[th.dataset.name]: entry[th.dataset.name].toDateString();
                if(th.dataset.name==="billAmt"){
                    if(entry.payments!==entry.billAmt && paymentStatus)
                        td.classList.add("partial-payment");
                    else if(entry.payments===entry.billAmt && paymentStatus){
                        td.classList.add("paid");
                    } else
                        td.classList.add("unpaid");
                }
                tr.appendChild(td)
            })
            tbody.appendChild(tr)
        })
});

tbody.addEventListener("mouseover",e=>{
    if(e.target.parentNode.nodeName==="TR"){
        [...e.target.parentNode.children].forEach(td=>{
            td.classList.add("hover")
        })
    }
});

tbody.addEventListener("mouseout",e=>{
    if(e.target.parentNode.nodeName==="TR"){
        [...e.target.parentNode.children].forEach(td=>{
            td.classList.remove("hover")
        })
    }
});

function getBillTotals(itemList){
    let totalWithoutTax = 0,totalTax = 0, totalWithTax;
    itemList.forEach(item=>{
        let itemTax = (100+Number(item.tax.split("%")[0]))/100;
        let pricePerUnit = Math.round(item.rate/itemTax);
        let {quantity} = item;
        totalWithoutTax += (quantity*pricePerUnit);
        totalTax += Math.round((itemTax-1)*pricePerUnit*quantity);//070880
    })
    totalWithTax = totalWithoutTax + totalTax;
    return {totalWithoutTax,totalTax,totalWithTax}
}

tbody.addEventListener("click",async e=>{
    if(e.target.parentNode.nodeName==="TR"){
        let itemTable = e.target.parentNode.dataset.itemList;
        let itemList = await ipcRenderer.invoke("load-purchase-itemList",e.target.parentNode.dataset.itemList);
        let {totalWithoutTax,totalTax, totalWithTax} = getBillTotals(itemList);
        let [id,billNo,date] = itemTable.split("_");
        date = (new Date(date)).toDateString();
        let { name:supplierName, gst, address, phones }= await ipcRenderer.invoke("get-supplier-name",id);
        [...modalHeader.children].forEach(div=>div.remove());//cleaning modal header
        [...modalTbody.children].forEach(tr=>tr.remove());//cleaning modal tbody rows
        [...modalFooter.children].forEach(div=>div.remove());//cleaning modal footer
        modalHeader.innerHTML = `
                        <div class="row0">
                            <p>
                                Name:
                                <span>${supplierName}</span>
                            </p>
                            <p>
                                GST No:
                                <span>${gst}</span>
                            </p>
                        </div>
                        <div class="row1">
                            <p>
                                Bill No:
                                <span>${billNo}</span>
                            </p>
                            <p>
                                Date:
                                <span>${date}</span>
                            </p>
                        </div>
        `;
        itemList.forEach(item=>{
            let tr = document.createElement("tr");
            modalThs.forEach(th=>{
                let td = document.createElement("td");
                td.textContent = th.dataset.name!=="rate"?item[th.dataset.name]:Math.round(item[th.dataset.name]);
                tr.appendChild(td);
            });
            modalTbody.appendChild(tr);
        });
        modalFooter.innerHTML = `
                        <div class="row0">
                            <p>${getAmtToWord()}</p>
                            <p>Total in words</p>
                        </div>
                        <div class="row1">
                            <p>
                                Total without Tax:
                                <span>${totalWithoutTax}</span>
                            </p>
                            <p>
                                Total Tax:
                                <span>${totalTax}</span>
                            </p>
                            <p>
                                Total with Tax:
                                <span>${totalWithTax}</span>
                            </p>
                        </div>
        `;
        cover.classList.remove("hide");
        modal.classList.remove("hide");
        let firstP = modalHeader.querySelector("p:first-child");
        firstP.addEventListener("mouseover",async function(){
            let div = this.parentNode;
            let contactDiv = document.createElement("div");
            contactDiv.id = "contact-popup"
            contactDiv.innerHTML = `
                        <div id="contact-wrapper">
                            <div>
                                <p>Address</p>
                                <p>Phone</p>
                            </div>
                            <div>
                                <p>${address}</p>
                                ${(JSON.parse(phones)).map(phone=>`<p>${phone}</p>`)}
                            </div>
                        </div>
            `
            div.appendChild(contactDiv);
        })
        firstP.addEventListener("mouseout",function(){
            this.parentNode.querySelector("#contact-popup").remove();
        })
    }
});

function getAmtToWord(){
    return "Some number in words."
}