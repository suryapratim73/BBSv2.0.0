const {Sequelize, DataTypes, UUIDV4} = require("sequelize");
const fs = require("fs");
let { appLogger } = require("../common");
const { app } = require("electron");
const path = require("path");
const { serializeSchema } = require("./schemaLoader");
require("dotenv").config({path:path.resolve(__dirname,"../.env")});


//Example of how to run sudo command using child process but limited buffer.
// let proc = exec("echo 'sysPassword' | sudo -S ls /root",(err,stdout,stderr)=>{
//     if(err) throw err;
//     if(stderr) throw stderr;
//     console.log(stdout)
// });

let appPath,tempStr="",timer;
if(process.env.APP_ENV==="DEV")
    appPath = path.resolve(__dirname,"../");
else
    appPath = app.getPath("appData")+"/BBS";
const sequelize = new Sequelize({
    dialect:"sqlite",
    storage:path.resolve(appPath,"./db/bbs.db"),
    logging:null,
    transactionType:"IMMEDIATE",
    retry: {
        max: 5,
        match: [
            /SQLITE_BUSY/,
            /database is locked/
        ]
    }
});

sequelize.authenticate()
.then(async ()=>{
    // Enable WAL mode for better concurrent read/write performance
    // and set busy_timeout so SQLite retries instead of immediately failing with SQLITE_BUSY
    await sequelize.query("PRAGMA journal_mode=WAL");
    await sequelize.query("PRAGMA busy_timeout=5000");
    appLogger({title:"SQLite DB Connection", message:"Connected to sqlite db", func:"dbConfig"});
})
.catch((err)=>{
    appLogger({title:"SQLite DB Connection Error", message: String(err), func:"dbConfig"});
});

let path2schema = path.resolve(appPath,"./model/schema.json");

function exportModules(){
let schemas = fs.readFileSync(path2schema);
    appLogger({title:"Schema file found", message:"Loading schemas...", func:"dbConfig.exportModules"});
    const { supplier,freight,people,customerSchema,stockSchema,serviceSchema,purchaseSchema,saleSchema,outPaymentSchema,inPaymentSchema,returnRegister,attendanceSchema,requirementSchema,userSchema,financialRecordSchema } = require("./schemaLoader").deserializeSchema(schemas,DataTypes,UUIDV4);   
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
            timestamps:false,
            setterMethods:{
                updateMoreInfo(moreInfo){
                    let currMoreInfo = this.getDataValue("moreInfo") || {};
                    let updatedMoreInfo = {...currMoreInfo,...moreInfo};
                    this.setDataValue("moreInfo",updatedMoreInfo);
                }
            }
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
                },
                updateBillValues: function({del_billAmt,del_netAmt,del_tax}){
                    this.setDataValue("billAmt",this.getDataValue("billAmt")+del_billAmt);
                    this.setDataValue("netAmt",this.getDataValue("netAmt")+del_netAmt);
                    this.setDataValue("tax",this.getDataValue("tax")+del_tax);
                    this.setDataValue("netDue",this.getDataValue("netDue")+Math.round(del_billAmt))
                },
                setBillValues:function(billMeta){
                    Object.keys(billMeta).forEach(key=>{
                        this.setDataValue(key,billMeta[key]);
                    });
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
        financial_record: sequelize.define("financial_record",financialRecordSchema,{
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
            user:userSchema,
            financial_record:financialRecordSchema
        }
    }
}

if(!fs.existsSync(path2schema)){
    let path2schemaJS = path.resolve(appPath,"./model/schema.js");
    let path2dynamicJS = path.resolve(appPath,"./model/dynamicSchemas.js");
    if(!fs.existsSync(path2schemaJS)){
        appLogger({
            title:"Bootstrap Case: Schema JSON Files missing. Checking for schema JS files...",
            message:`schema JS file exists: ${fs.existsSync(path2schemaJS)}`,
            func:"dbConfig"
        });
        global.needsSchemaBootstrap = true;
        module.exports = {};
    }
    else{
        appLogger({
            title:"Schema JSON Files missing, but schema JS files found. Generating schema JSON files...",
            message:`schema JS file exists: ${fs.existsSync(path2schemaJS)}`,
            func:"dbConfig"
        });
        let { serializedSchema, serializedDynamic } = serializeSchema(path2schemaJS,path2dynamicJS);
        fs.writeFileSync(path2schema,serializedSchema);
        fs.writeFileSync(path.resolve(appPath,"./model/dynamicSchemas.json"),serializedDynamic);
        global.needsSchemaBootstrap = false;
        exportModules();
    }
}
else
    exportModules();

// sequelize.sync({
//     force:true,
//     alter:true
// }).then(()=>console.log("sequelize sync done")).catch(console.log);