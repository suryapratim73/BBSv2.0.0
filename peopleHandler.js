const { freight,people } = require("./model/dbConfig");
const { ipcMain } = require("electron");
const { People } = require("./common");


let freightList = [],
    peopleList = [];

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
})

exports.getFreights = ()=>(freightList);