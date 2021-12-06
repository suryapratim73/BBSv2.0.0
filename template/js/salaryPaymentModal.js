const { ipcRenderer } = require("electron");
const { toggleDevTool, drawSpinner, validateInput2, validateInput } = require("../js/common");


toggleDevTool(document);

let empPayArr = [];

async function initPage(){
    let spinner = drawSpinner(document);
    let empCardTem = document.getElementById("employee-card-template");
    let main = document.querySelector("main");
    document.querySelector("nav h2").textContent = "Salary disbursement for the month of " + new Date().toLocaleDateString("en-GB",{
        month: 'long'
    });
    let eligibleEmps = (await ipcRenderer.invoke("get-own-employees"))
    .filter(({moreInfo:{joinDate}})=>{
        let [year,month,date] = joinDate.split("-");
        if(new Date(year,month,date)-Date.now()>30*24*60*60*1000)
            return true;
        else
            return false;
    });
    if(eligibleEmps.length===0) return ipcRenderer.send("close","Salary-Modal");
    eligibleEmps.forEach(({id,name,moreInfo:{payHistory,salary}})=>{
        let {payment=0,payDeficit=0} = payHistory.filter(({date})=>(new Date(date).getMonth()===new Date().getMonth()))[0] ?? {};
        if(payment<Number(salary)){
            let cardDiv = empCardTem.content.cloneNode(true).querySelector("div");
            cardDiv.querySelector("p").textContent = name;
            cardDiv.querySelector("p[data-colname='salary']").innerHTML = `
                Allocated salary is Rs.${salary}
                <span data-msg="Update salary from the Employee Portal" class="hover left bottom">i</span>
            `;
            cardDiv.querySelector(`p[data-colname="amtPaid"]`).textContent = `Payment deficit is Rs.${payDeficit}`;
            cardDiv.dataset.payDeficit = Number(payDeficit);
            cardDiv.dataset.id = id;
            cardDiv.dataset.salary = salary;
            cardDiv.dataset.payment = payment;
            main.appendChild(cardDiv);
        }
    });
    spinner.remove(window);
}
initPage();

function popCard(e){
    let target = e.target;
    if(target.nodeName==="BUTTON"){
        let empCard = target.parentNode.parentNode;
        let {salary,id,payment,payDeficit} = empCard.dataset;
        let paidAmt = Number(empCard.querySelector("input").value) + Number(payment);
        if(Number(empCard.querySelector("input").value)===0){
            paidAmt = payDeficit;
            empCard.querySelector("input").value = paidAmt;
        }
        let bonus = Math.sign(paidAmt-Number(salary))>0?paidAmt-Number(salary):0;
        payDeficit = Math.sign(paidAmt-Number(salary))<0?Number(salary)-paidAmt:0;
        empPayArr.push({id,payment:paidAmt,bonus,payDeficit})
        empCard.classList.add("hide-card")
        setTimeout(()=>{
            empCard.remove();
            if([...document.querySelectorAll("main .emp-card")].length===0)
                ipcRenderer.send("register-salary-payment",empPayArr)
        },305);
    }
}