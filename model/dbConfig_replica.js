const {Sequelize, DataTypes, UUIDV4} = require("sequelize");
const fs = require("fs");
let {getLoggerFD} = require("../common");
const { app } = require("electron");
const path = require("path");
const {exec} = require("child_process");


//Example of how to run sudo command using child process but limited buffer.
// let proc = exec("echo 'sysPassword' | sudo -S ls /root",(err,stdout,stderr)=>{
//     if(err) throw err;
//     if(stderr) throw stderr;
//     console.log(stdout)
// });
console.log({msg:"Executing dbReplica"})
let appPath,tempStr="",timer;
if(process.env.APP_ENV==="DEV")
    appPath = path.resolve(__dirname,"../");
else
    appPath = app.getPath("appData")+"/BBS";
const sequelize = new Sequelize({
    dialect:"sqlite",
    storage:path.resolve(appPath,"./db/bbs_replica.db"),
    logging:function(...msg){
        if(global.shouldWait)
            tempStr += msg[0] + "\n";
        else
        if(global.shouldWait===false )
        {
            let loggerFD = getLoggerFD?.("dbLogs.txt");
            if(tempStr){
                appendToFile(loggerFD,tempStr+msg[0]);
                console.log("Appending temStr");
                tempStr = undefined;
            }
            else{
                // console.log(msg[0])
                appendToFile(loggerFD,msg[0]);
            }
        }
    },
    transactionType:"IMMEDIATE"
});

async function appendToFile(fd,data){
    let timer;
    if(!fd){
        fd = await new Promise(res=>{
            timer = setInterval(()=>{
                try{
                    fd = require("../common").getLoggerFD?.("dbLogs.txt");
                    if(fd){
                        clearInterval(timer);
                        res(fd);
                    }
                }
                catch(err){
                    console.log({err,msg:"Reattempting fd retrieval"})
                }
            },50);
        });
    }
    fs.appendFile(fd,data+"\n",{flag:"a+"},(err)=>{
        if(err) throw err;
    });
}

sequelize.authenticate()
.then(()=>{
    console.log("Connected to sqlite db");
})
.catch((err)=>{
    console.error(err)
});

const supplier = {
    id:{
        type: DataTypes.UUID,
        defaultValue:UUIDV4,
        primaryKey:true
    },
    name:{
        type:DataTypes.TEXT
    },
    address:{
        type:DataTypes.TEXT
    },
    phones:{
        type:DataTypes.JSON
    },
    gst:{
        type:DataTypes.TEXT
    },
    moreInfo:{
        type:DataTypes.JSON,
        defaultValue:{}
    },
    paymentReciever:{
        type:DataTypes.UUID,
    }
}

const freight = {
    id:{
        type: DataTypes.UUID,
        defaultValue:UUIDV4,
        primaryKey:true
    },
    name:{
        type:DataTypes.TEXT
    },
    address:{
        type:DataTypes.TEXT
    },
    phones:{
        type:DataTypes.JSON
    },
    gst:{
        type:DataTypes.TEXT
    },
    moreInfo:{
        type:DataTypes.JSON,
        defaultValue:{}
    }
}

const people = {
    id:{
        type: DataTypes.UUID,
        defaultValue:UUIDV4,
        primaryKey:true
    },
    relation:{
        type:DataTypes.JSON,
        allowNull:false
    },
    name:{
        type:DataTypes.TEXT
    },
    address:{
        type:DataTypes.TEXT
    },
    phones:{
        type:DataTypes.JSON
    },
    moreInfo:{
        type:DataTypes.JSON,
        defaultValue:{}
    }
}

const customerSchema = {
    id:{
        type: DataTypes.UUID,
        defaultValue:UUIDV4,
        primaryKey:true
    },
    name:{
        type:DataTypes.TEXT
    },
    address:{
        type:DataTypes.TEXT
    },
    phones:{
        type:DataTypes.TEXT// Replace this line with the line below before next db reset
        // type:DataTypes.JSON 
    },
    gst:{
        type:DataTypes.TEXT
    },
    score:{
        type:DataTypes.NUMBER,
        defaultValue: 0
    },
    moreInfo:{
        type:DataTypes.JSON,
        defaultValue:[]
    }
}

const stockSchema = {
    id:{
        type: DataTypes.UUID,
        defaultValue:UUIDV4,
        primaryKey:true
    },
    name:{
        type:DataTypes.TEXT,
        allowNull:false
    },
    hsn:{
        type:DataTypes.NUMBER,
        defaultValue:7318
    },
    type:{
        type:DataTypes.TEXT
    },
    quantity:{
        type:DataTypes.INTEGER,
        defaultValue:0
    },
    unit:{
        type:DataTypes.TEXT,
        defaultValue:"Kg"
    },
    buyPrice:{
        type:DataTypes.INTEGER,
        allowNull:false
    },
    standardSellPrice:{
        type:DataTypes.INTEGER,
        defaultValue:0
    },
    lastSellPrice:{
        type: DataTypes.INTEGER,
        defaultValue:0
    },
    specialPrice:{
        type: DataTypes.JSON,
        defaultValue:[]
    },
    tax:{
        type: DataTypes.INTEGER
    },
    sgst:{
        type: DataTypes.INTEGER
    },
    cgst:{
        type: DataTypes.INTEGER
    },
    igst:{
        type: DataTypes.INTEGER
    },
    pInfo:{
        type: DataTypes.JSON,
        defaultValue: {}
    },
    pHistory:{
        type: DataTypes.JSON,
        defaultValue: []
    },
    pScore:{
        type: DataTypes.NUMBER,
        defaultValue: 0
    }
}

const serviceSchema = {
    id:{
        type: DataTypes.UUID,
        defaultValue:UUIDV4,
        primaryKey:true
    },
    name:{
        type:DataTypes.TEXT,
        allowNull:false
    },
    hsn:{
        type:DataTypes.NUMBER,
        defaultValue:7318
    },
    type:{
        type:DataTypes.TEXT
    },
    unit:{
        type:DataTypes.TEXT,
        defaultValue:"Kg"
    },
    standardSellPrice:{
        type:DataTypes.INTEGER,
        defaultValue:0
    },
    lastSellPrice:{
        type: DataTypes.INTEGER,
        defaultValue:0
    },
    specialPrice:{
        type: DataTypes.JSON,
        defaultValue:[]
    },
    tax:{
        type: DataTypes.INTEGER
    },
    pInfo:{
        type: DataTypes.JSON,
        defaultValue: {}
    },
    pScore:{
        type: DataTypes.NUMBER,
        defaultValue: 0
    }
}

const purchaseSchema = {
    entryNo:{
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    supplierId: {
        type: DataTypes.UUID,
        allowNull:false
    },
    supplierName:{
        type: DataTypes.TEXT,
        allowNull: false
    },
    billNo:{
        type: DataTypes.INTEGER,
        allowNull: false
    },
    billDate:{
        type: DataTypes.DATE,
        allowNull: false
    },
    billAmt:{
        type: DataTypes.INTEGER,
        allowNull: false
    },
    tax:{
        type: DataTypes.INTEGER,
        allowNull: false
    },
    payment:{
        type:DataTypes.INTEGER
    },
    paymentStatus:{
        type:DataTypes.BOOLEAN
    },
    billItemTable:{
        type:DataTypes.TEXT,
        allowNull: false
    },
    moreInfo:{
        type:DataTypes.JSON
    }
}

const saleSchema = {
    entryNo:{
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    billStatus:{
        type:DataTypes.BOOLEAN
    },
    customerId: {
        type: DataTypes.UUID,
        allowNull:false
    },
    name:{
        type: DataTypes.TEXT,
        allowNull: false
    },
    billNo:{
        type: DataTypes.INTEGER,
        allowNull: false
    },
    billDate:{
        type: DataTypes.DATE,
        allowNull: false
    },
    billType:{
        type: DataTypes.TEXT
    },
    billAmt:{
        type: DataTypes.INTEGER,
        allowNull: false
    },
    netAmt:{
        type: DataTypes.INTEGER,
        allowNull: false
    },
    tax:{
        type: DataTypes.INTEGER,
        allowNull: false
    },
    payment:{
        type:DataTypes.INTEGER
    },
    paymentStatus:{
        type:DataTypes.BOOLEAN
    },
    netDue:{
        type:DataTypes.INTEGER
    },
    billItemTable:{
        type:DataTypes.TEXT,
        allowNull: false
    },
    deliveryStatus:{
        type:DataTypes.TEXT,
        defaultValue:"queued"
    },
    autoBill:{
        type:DataTypes.BOOLEAN,
        defaultValue: false
    },
    orderRef:{
        type:DataTypes.TEXT
    },
    delivery:{
        type:DataTypes.JSON,
        defaultValue:"hand"
    }
}

const outPaymentSchema = {
    entryNo:{
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    beneficiaryId:{
        type: DataTypes.UUID,
        defaultValue:UUIDV4
    },
    type:{
        type: DataTypes.TEXT,
        defaultValue:"general"
    },
    payment:{
        type: DataTypes.INTEGER,
        defaultValue:0
    },
    date:{
        type: DataTypes.DATE,
        allowNull:false
    },
    moreInfo:{
        type:DataTypes.JSON
    }
}

const inPaymentSchema = {
    entryNo:{
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    id:{
        type: DataTypes.UUID,
        allowNull:false
    },
    type:{
        type: DataTypes.TEXT,
        defaultValue:"sale"
    },
    payment:{
        type: DataTypes.INTEGER,
        defaultValue:0
    },
    date:{
        type: DataTypes.DATE
    },
    moreInfo:{
        type: DataTypes.JSON
    }
}

const returnRegister = {
    entryNo:{
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    itemList:{
        type: DataTypes.JSON,
        allowNull: false
    },
    billMeta:{
        type: DataTypes.JSON,
        allowNull: false
    },
    retAmt:{
        type: DataTypes.NUMBER,
        allowNull: false
    },
    retDate:{
        type: DataTypes.DATE,
        allowNull: false
    },
    id:{
        type: DataTypes.UUID,
        allowNull: false
    }
}

const attendanceSchema = {
    dayId:{
        type: DataTypes.UUID,
        primaryKey: true
    },
    date: {
        type: DataTypes.TEXT,
    },
    attendees:{
        type: DataTypes.JSON
    }
}

const requirementSchema = {
    entryNo:{
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    itemList:{
        type: DataTypes.JSON
    },
    header:{
        type: DataTypes.JSON
    },
    status:{
        type: DataTypes.TEXT,
    }
};

const userSchema = {
    id:{
        type: DataTypes.UUID,
        primaryKey: true
    },
    name:{
        type: DataTypes.TEXT
    },
    passwd:{
        type: DataTypes.TEXT
    },
    role:{
        type: DataTypes.TEXT
    },
    lastLogin:{
        type: DataTypes.TIME
    },
    secret:{
        type: DataTypes.TEXT
    },
    session:{
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    sessionTime:{
        type: DataTypes.TIME
    },
    usePasswd:{
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
};

const financialRecordSchema = {
    id:{
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue:UUIDV4
    },
    finYear:{
        type: DataTypes.DATE
    },
    closingStock:{
        type: DataTypes.NUMBER
    },
    grossCredit:{
        type: DataTypes.NUMBER
    },
    grossDebt:{
        type: DataTypes.NUMBER
    },
    advNetIncome:{
        type: DataTypes.NUMBER
    },
    advNetExpence:{
        type: DataTypes.NUMBER
    }
}

module.exports = {
    supplier: sequelize.define("supplier",supplier,{
        freezeTableName:false,
        timestamps:false
    }),
    freight: sequelize.define("freight",freight,{
        freezeTableName:false,
        timestamps:false
    }),
    people: sequelize.define("people",people,{
        freezeTableName:false,
        timestamps:false
    }),
    customer: sequelize.define("customers",customerSchema,{
        freezeTableName:false,
        timestamps:false
    }),
    sequelize,
    stock: sequelize.define("stock",stockSchema,{
        freezeTableName:false,
        timestamps:false,
        setterMethods:{
            updateStock({quantity,price}){
                this.setDataValue("quantity",Number(this.getDataValue("quantity"))+Number(quantity));
                this.setDataValue("buyPrice",Number(this.getDataValue("buyPrice"))+Number(price));
                this.setDataValue("standardSellPrice",1.1*Number(this.getDataValue("buyPrice")));
            },
            reduceStock(quantity){
                this.setDataValue("quantity",Number(this.getDataValue("quantity"))-Number(quantity));
            }
        }
    }),
    purchase: sequelize.define("purchase",purchaseSchema,{
        freezeTableName: false,
        timestamps: false
    }),
    sale: sequelize.define("sale",saleSchema,{
        freezeTableName: false,
        timestamps: false,
        setterMethods:{
            closeBill(){
                this.setDataValue("billStatus","open");
            }
        }
    }),
    outPayments: sequelize.define("outPayments",outPaymentSchema,{
        freezeTableName:true,
        timestamps:false,
        setterMethods:{
            addOutPayment(updateObj){
                console.log(updateObj,"From setter method")
            }
        }
    }),
    inPayments: sequelize.define("inPayments",inPaymentSchema,{
        freezeTableName:true,
        timestamps:false
    }),
    returnRegister: sequelize.define("returnRegister",returnRegister,{
        freezeTableName:true,
        timestamps:false
    }),
    service: sequelize.define("service",serviceSchema,{
        freezeTableName: true,
        timestamps: false
    }),
    attendances: sequelize.define("attendances",attendanceSchema,{
        freezeTableName: true,
        timestamps: false
    }),
    requirement: sequelize.define("requirement",requirementSchema,{
        freezeTableName: true,
        timestamps: false
    }),
    user: sequelize.define("user",userSchema,{
        freezeTableName: true,
        timestamps: false
    }),
    finData: sequelize.define("financial_record",financialRecordSchema,{
        freezeTableName: true,
        timestamps: false
    }),
    schemas:{
        supplier,
        freight,
        people,
        customers:customerSchema,
        stock:stockSchema,
        purchase:purchaseSchema,
        sale:saleSchema,
        outPayments:outPaymentSchema,
        inPayments:inPaymentSchema,
        returnRegister,
        service:serviceSchema,
        attendances:attendanceSchema,
        requirement:requirementSchema,
        user:userSchema
    }
}

// sequelize.sync({
//     force:true,
//     alter:true
// }).then(()=>console.log("sequelize sync done")).catch(console.log);