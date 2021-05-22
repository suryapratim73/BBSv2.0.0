const { sequelize } = require("./model/dbConfig")


exports.getLedgerModel = async function getLedgerModel(id,ledgerSchema){
    let supplierLedger = `${id}Ledger`;
    supplierLedger = await sequelize.define(supplierLedger,ledgerSchema,{
        freezeTableName: true,
        timestamps: false
    }).sync();
    return supplierLedger
}

exports.getBillModel = async function getBillModel(id,billNo,billDate,billSchema){
    let itemListTable = `${id}_${billNo}_${billDate}`;
    let billModel = await sequelize.define(itemListTable,billSchema,{
        freezeTableName: true,
        timestamps: false
    }).sync();
    return billModel
}