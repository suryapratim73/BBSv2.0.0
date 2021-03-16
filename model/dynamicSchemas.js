const { DataTypes } = require("sequelize")

exports.supplierLedgerSchema = {
    entryNo:{
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    date:{
        type:DataTypes.DATE
    },
    billNo:{
        type: DataTypes.INTEGER
    },
    billAmt:{
        type:DataTypes.INTEGER
    },
    paymentStatus:{
        type:DataTypes.BOOLEAN
    },
    payments:{
        type:DataTypes.INTEGER,
        defaultValue:0
    },
    netDue:{
        type:DataTypes.INTEGER,
        defaultValue:0
    },
    itemList:{
        type:DataTypes.TEXT,
        allowNull:false
    }
}

exports.billItemSchema = {
    itemNo:{
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    name:{
        type:DataTypes.TEXT,
        allowNull:false
    },
    type:{
        type:DataTypes.TEXT
    },
    hsn:{
        type:DataTypes.INTEGER,
        defaultValue:7318
    },
    quantity:{
        type: DataTypes.INTEGER
    },
    unit:{
        type: DataTypes.TEXT,
        defaultValue:"Kg"
    },
    rate:{
        type:DataTypes.INTEGER,
        allowNull:false
    },
    tax:{
        type: DataTypes.TEXT
    }
}