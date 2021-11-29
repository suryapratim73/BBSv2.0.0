const { freight,people,attendances } = require("./model/dbConfig");
const { ipcMain,dialog,BrowserWindow } = require("electron");
const { People,appLogger } = require("./common");
const { createModal } = require("./createModal");
const uuid = require("uuid");


let freightList = [],
    peopleList = [];

exports.employeePortal = mainWindow => {
    return ()=>{
        let windowOptions = {
            width: 800,
            height: 600,
            resizable:false,
            webPreferences: {
                nodeIntegration: true,
                devTools:true
            },
            show:false,
            contextIsolation:true,
            parent: mainWindow
        };
        let pathToHTML = "./template/html/employeePortal.html";
        createModal(windowOptions,pathToHTML,{maxWinCount:1,label:"Employee-Page"});
    }
}

ipcMain.handle("get-freights",async e=>{
    if(freightList.length>0) return freightList;
    let frgtList = (await (await freight.sync()).findAll({
        attributes: [ "name", "id", "charge" ]
    })).map(({dataValues})=>dataValues);
    frgtList.forEach(frieghtObj=>{
        frieghtObj._type = "freight";
        freightList.push(new People(frieghtObj))
    });
    return freightList;
});

ipcMain.handle("get-employee-names",async (e,id)=>{
    let employeesToSupp = (await people.findAll({
        where:{
            relation:{
                relTo:id
            }
        },
        attributes:["id","name"]
    })).map(({dataValues})=>dataValues);
    return employeesToSupp;
});

ipcMain.handle("get-coolies",async e=>{
    return (await (await people).findAll({
        where:{
            relation:"Coolie"
        }
    })).map(({dataValues})=>dataValues);
});

ipcMain.on("new-employee",(e,empObj)=>{
    people.findOrCreate({
        where:{id:empObj.id},
        defaults:{
            id: empObj.id,
            relation: "Employee",
            name: empObj.name,
            address: empObj.address,
            phones: empObj.phones,
            moreInfo: {
                payDate: empObj.payDate,
                salary: empObj.salary,
                attendance: [],
                payHistory: []
            }
        }
    })
    .then(([{dataValues}])=>{
        peopleList.push(new People(dataValues));
        let msg = {
            type: "info",
            title: "New Employee Registered",
            message: "New Employee added to database."
        }
        dialog.showMessageBox(BrowserWindow.getFocusedWindow(),msg);
        const {id=null,name=""} = dataValues;
        appLogger("new Employee added to database",JSON.stringify({id,name}));
        e.sender.send("new-employee-response");
    })
    .catch(console.log)
});

async function initEmployeeList(){
    try{
        (await people.findAll({
            where:{
                relation:"Employee"
            }
        }))
        .forEach(({dataValues})=>{
            peopleList.push(new People(dataValues));
            return dataValues
        });
    }
    catch(err){
        console.log({err});
    }
    return;
}

ipcMain.handle("get-own-employees",async ()=>{
    if(peopleList.length===0)
        await initEmployeeList();
    return peopleList.map(obj=>obj.relation==="Employee");
});

ipcMain.handle("get-own-employee-names",async ()=>{
    if(peopleList.length===0) 
        await initEmployeeList()
    return peopleList.map(({id,name,relation})=>{
        if(relation==="Employee")
            return {id,name};
    });
});

ipcMain.on("update-attendace-registry",(e,attenArr)=>{
    attendances.create({
        dayId: uuid.v5(new Date().toDateString(),"6ba7b814-9dad-11d1-80b4-00c04fd430c8"),
        date: new Date().toDateString(),
        attendees: attenArr
    })
    .then(()=>{
        let msg = {
            type: "info",
            title: "Attendance registered",
            message: "Attendance registered."
        }
        dialog.showMessageBox(BrowserWindow.getFocusedWindow(),msg);
        BrowserWindow.getFocusedWindow().close();
    })
});

exports.getFreights = ()=>(freightList);
exports.peopleList = peopleList;
exports.initEmployeeList = initEmployeeList;