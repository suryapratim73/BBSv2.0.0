const {Sequelize, DataTypes, UUIDV4} = require("sequelize");

const sequelize = new Sequelize({
    dialect:"sqlite",
    storage:"./db/usha.db"
})

sequelize.authenticate()
.then(()=>{
    console.log("Connected to sqlite db")
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
        type:DataTypes.TEXT
    },
    gst:{
        type:DataTypes.TEXT
    },
    comment:{
        type:DataTypes.TEXT
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
        type:DataTypes.TEXT
    },
    gst:{
        type:DataTypes.TEXT
    },
    comment:{
        type:DataTypes.TEXT
    }
}

const transporterSchema = {
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
    phone:{
        type:DataTypes.TEXT
    },
    charge:{
        type:DataTypes.TEXT
    }
}

const stockSchema = {
    itemNo:{
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
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
    tax:{
        type: DataTypes.INTEGER
    },
    location:{
        type:DataTypes.TEXT,
        defaultValue: "any"
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
    billItemTable:{
        type:DataTypes.TEXT,
        allowNull: false
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
    }
}

const inPaymentSchema = {
    entryNo:{
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    customerId:{
        type: DataTypes.UUID,
        allowNull:false
    },
    payment:{
        type: DataTypes.INTEGER,
        defaultValue:0
    },
    date:{
        type: DataTypes.DATE
    }
}

module.exports = {
    supplier: sequelize.define("supplier",supplier,{
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
            updateStock({quantity,price,location}){
                this.setDataValue("quantity",Number(this.getDataValue("quantity"))+Number(quantity));
                this.setDataValue("buyPrice",Number(this.getDataValue("buyPrice"))+Number(price));
                this.setDataValue("standardSellPrice",1.1*Number(this.getDataValue("buyPrice")));
                this.setDataValue("location",location);
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
    transporters: sequelize.define("transporters",transporterSchema,{
        freezeTableName:true,
        timestamps:false
    })
}