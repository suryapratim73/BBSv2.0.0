const { freight,people,attendances, outPayments } = require("./model/dbConfig");
const { ipcMain,dialog,BrowserWindow } = require("electron");
const { People,appLogger, checkAuthority } = require("./common");
const { createModal, getTargetWindow } = require("./createModal");
const uuid = require("uuid");
const { updateCloseFlag } = require("./main");
const { generateVoucher } = require("./scripts/makePDF.default");


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
        let win = createModal(windowOptions,pathToHTML,{maxWinCount:1,label:"Employee-Page"});
        // win?.on("close",e=>{
        //     e.preventDefault();
        //     console.log("stopping closure")
        //     // e.sender.send("update-attendance-close");
        // });
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
                attendance: [],
                payHistory: [],
                ...Object.keys(empObj)
                    .reduce((acc,key)=>{
                        if(!["id","name","address","phones"].includes(key))
                            acc[key] = empObj[key];
                        return acc;
                    },{})
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
    return peopleList.filter(obj=>obj.relation==="Employee");
});

ipcMain.on("update-attendace-registry",async (e,attenArr)=>{
    let res = (await attendances.findOrCreate({
        where:{
            dayId: uuid.v5(new Date().toDateString(),"6ba7b814-9dad-11d1-80b4-00c04fd430c8"),
        },
        defaults:{
            dayId: uuid.v5(new Date().toDateString(),"6ba7b814-9dad-11d1-80b4-00c04fd430c8"),
            date: new Date().toDateString(),
            attendees: attenArr
        }
    }))[0];
    if(!res._options.isNewRecord)
        await attendances.update({
            attendees: attenArr
        },
        {
            where:{
                dayId: uuid.v5(new Date().toDateString(),"6ba7b814-9dad-11d1-80b4-00c04fd430c8")
            },
        })
    Promise.all([
        ...attenArr.map(async ({presence,id})=>{
            let moreInfo = (await people.findOne({
                where:{
                    id
                },
                attributes:["moreInfo"]
            })).dataValues.moreInfo;
            if(!moreInfo.attendance.find(obj=>obj.date==new Date().toDateString()))
                moreInfo.attendance.push({presence,date: new Date().toDateString()});
            else
                moreInfo.attendance.find(obj=>obj.date==new Date().toDateString()).presence = presence;
            let emp = peopleList.find(obj=>obj.id===id);
            emp.moreInfo = moreInfo;
            return people.update({
                moreInfo
            },{
                where:{
                    id
                }
            });
        })
    ])
    .then(()=>{
        let msg = {
            type: "info",
            title: "Attendance registered",
            message: "Attendance registered."
        }
        dialog.showMessageBox(BrowserWindow.getFocusedWindow(),msg);
        let attenModal = getTargetWindow("Attendance-modal");
        if(attenModal){
            updateCloseFlag();
            attenModal.close();
        }
        ipcMain.emit("attendance-registered");
    })
    .catch(console.log);
});

ipcMain.handle("fire-employee",async (e,id)=>{
    await checkAuthority();
    peopleList = peopleList.filter(obj=>obj.id!==id);
    await people.destroy({
        where:{id}
    });
    return true;
});

ipcMain.handle("update-employee",async (e,empObj)=>{
    let selectedEmp = peopleList.find(obj=>obj.id===empObj.id);
    for(let key in selectedEmp)
        if(typeof selectedEmp[key]!=="object" && key in empObj)
            selectedEmp[key] = empObj[key];
        else
            for(let key2 in selectedEmp[key])
                selectedEmp[key][key2] = key2 in empObj ? empObj[key2]: selectedEmp[key][key2];
    await people.update({
        name:empObj.name,
        address: empObj.address,
        phones: empObj.phones,
        moreInfo: selectedEmp.moreInfo
    },{
        where:{id:empObj.id}
    })
    let msg = {
        type: "info",
        title: "Update Successful",
        message: "Employee information has been successfully updates.."
    }
    dialog.showMessageBox(BrowserWindow.getFocusedWindow(),msg);
    return selectedEmp;
});

ipcMain.on("register-salary-payment",async (e,empPayArr)=>{
    if(peopleList.length===0)
        await initEmployeeList();
    Promise.all([
        ...empPayArr.map(async payObj=>{
            let {moreInfo} = (await people.findOne({
                where:{
                    id:payObj.id
                },
                attributes: ["moreInfo"]
            })).dataValues;
            if(!moreInfo.payHistory.some(({date})=>new Date(date).getMonth()===new Date().getMonth()))
                moreInfo.payHistory.push({
                    date: new Date(),
                    payment: Number(payObj.payment),
                    bonus: payObj.bonus,
                    payDeficit: payObj.payDeficit
                });
            else{
                let obj = moreInfo.payHistory.find(({date})=>new Date(date).getMonth()===new Date().getMonth());
                obj.date = new Date();
                obj.payment = Number(payObj.payment);
                obj.bonus = payObj.bonus;
                obj.payDeficit = payObj.payDeficit;
            }
            let emp = peopleList.find(obj=>obj.id===payObj.id);
            let obj = emp.moreInfo.payHistory.find(({date})=>new Date(date).getMonth()===new Date().getMonth());
            obj.date = new Date();
            obj.payment = Number(payObj.payment);
            obj.bonus = payObj.bonus;
            obj.payDeficit = payObj.payDeficit;
            return people.update({
                moreInfo
            },{
                where:{
                    id: payObj.id
                }
            })
        }),
        ...empPayArr.map(payObj=>{
            let path2pdf = generateVoucher({
                name: peopleList.find(obj=>obj.id===payObj.id)?.name,
                "pay-mode": "cash",
                "pay-amt": payObj.payment,
                "pay-date": new Date().toLocaleDateString("en-GB")
            });
            ipcMain.emit("show-print-modal",path2pdf,{pageFit:""});
            return outPayments.create({
                beneficiaryId: payObj.id,
                type: "salary",
                payment: payObj.payment,
                date: new Date()
            })
        })
    ])
    .then(()=>{
        let msg = {
            type: "info",
            title: "Salary registered",
            message: "Salary registered successfully."
        }
        dialog.showMessageBox(BrowserWindow.getFocusedWindow(),msg);
        getTargetWindow("Salary-Modal")?.close();
    })
    .catch(console.log);
});

exports.getFreights = ()=>(freightList);
exports.peopleList = peopleList;
exports.initEmployeeList = initEmployeeList;