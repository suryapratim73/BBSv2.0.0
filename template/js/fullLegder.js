const { ipcRenderer } = require("electron");
const {toggleDevTool,getAmtToWord} = require("../js/common");

toggleDevTool(document);

let tbody = document.querySelector("tbody");
let ths = document.querySelectorAll("#contact-div th");
let cover = document.querySelector(".cover");
let modal = document.querySelector(".modal");
let modalThs = document.querySelectorAll(".modal th");
let modalTbody = document.querySelector(".modal tbody");
let modalHeader = document.querySelector(".modal header");
let modalFooter = document.querySelector(".modal footer");
let filter = document.querySelector("#filter");
let filterBtn = document.querySelector("header button");
let selection = "*";

function closeModal(){
    modal.classList.add("hide");
    cover.classList.add("hide");
}

cover.addEventListener("click",closeModal);

filterBtn.addEventListener("click",()=>filter.classList.toggle("hide"));

filter.addEventListener("click",function(e){
    if(e.target===this) return;
    [...this.children].forEach(a=>a.classList.remove("selection"));
    selection = e.target.dataset.time!=="*"?Number(e.target.dataset.time):"*";
    e.target.classList.add("selection");
    this.classList.add("hide");
    applyFilter();
})

function applyFilter(){
    [...tbody.children].forEach(tr=>tr.classList.remove("hide")); 
    if(selection!=="*")
        [...tbody.children].forEach(tr=>{
            let billDate = new Date(tr.children[1].textContent);
            let currentDate = new Date();
            if(Math.ceil((currentDate-billDate)/(1000*60*60*24))>selection*30)
                tr.classList.add("hide")
        });
}//Need more testing

ipcRenderer.on("supplier-ledger-detail",async (e,{fullLedger,id,name})=>{
    if(tbody.children.length===0){
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
        });
        applyFilter();
    }
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
}// Rate per item is inclusive of tax conversion!! May need a change! 

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
                            <p>${getAmtToWord(totalWithTax)}</p>
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
});//done-17/3/21