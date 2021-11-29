const { toggleDevTool, drawSpinner } = require("../js/common");
const { ipcRenderer } = require("electron");


toggleDevTool(document);

let attendanceArr = [];

async function initPage(){
    let main = document.querySelector("main");
    let spinner = drawSpinner(document);
    document.querySelector("h2").textContent = `Attendance for ${new Date().toDateString()}`;
    let employeeList = (await ipcRenderer.invoke("get-own-employee-names"));
    employeeList.length===0 && ipcRenderer.send("close");
    let empCardTem = document.getElementById("employee-card-template");
    employeeList.forEach(empObj=>{
        let cardDiv = empCardTem.content.cloneNode(true).querySelector("div");
        cardDiv.querySelector("p").textContent = empObj.name;
        cardDiv.dataset.id = empObj.id;
        main.appendChild(cardDiv);
    });
    spinner.remove(window);
}
initPage();

function popCard(e){
    let target = e.target;
    if(target.nodeName==="BUTTON"){
        let empCard = target.parentNode.parentNode;
        attendanceArr.push({presence:target.dataset.value,id:empCard.dataset.id});
        empCard.remove();
        if([...document.querySelectorAll("main .emp-card")].length===0)
            ipcRenderer.send("update-attendace-registry",attendanceArr);
    }
}