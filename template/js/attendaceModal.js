const { toggleDevTool, drawSpinner } = require("../js/common");
const { ipcRenderer } = require("electron");


toggleDevTool(document);

let attendanceArr = [];

async function initPage(){
    let main = document.querySelector("main");
    let spinner = drawSpinner(document);
    document.querySelector("h2").textContent = `Attendance for ${new Date().toDateString()}`;
    let employeeList = (await ipcRenderer.invoke("get-own-employees"));
    spinner.remove(window);
    let empCardTem = document.getElementById("employee-card-template");
    employeeList = employeeList
                    .filter(({moreInfo:{attendance}})=>(!attendance.find(({date,presence})=>(date==new Date().toDateString() && (presence>0 || presence<0)))));
    employeeList.length===0 && ipcRenderer.send("close","Attendance-modal");
    employeeList.forEach(empObj=>{
        let cardDiv = empCardTem.content.cloneNode(true).querySelector("div");
        cardDiv.querySelector("p").textContent = empObj.name;
        cardDiv.dataset.id = empObj.id;
        main.appendChild(cardDiv);
    });
}
initPage();

function popCard(e){
    let target = e.target;
    if(target.nodeName==="BUTTON"){
        let empCard = target.parentNode.parentNode;
        attendanceArr.push({presence:Number(target.dataset.value),id:empCard.dataset.id});
        empCard.classList.add("hide-card")
        setTimeout(()=>{
            empCard.remove();
            if([...document.querySelectorAll("main .emp-card")].length===0)
                ipcRenderer.send("update-attendace-registry",attendanceArr);
        },305);
    }
}

ipcRenderer.on("update-attendance-close",e=>{
    [...document.querySelectorAll("main .emp-card")]
    .forEach(empCard=>{
        let id = empCard.dataset.id;
        if(!attendanceArr.find(obj=>obj.id===id))
            attendanceArr.push({presence:0,id});
    });
    e.sender.send("update-attendace-registry",attendanceArr);
});