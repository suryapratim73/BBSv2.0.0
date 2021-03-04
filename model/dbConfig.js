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
    type:{
        type:DataTypes.TEXT
    },
    quantity:{
        type:DataTypes.INTEGER,
        defaultValue:0
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

module.exports = {
    supplier: sequelize.define("supplier",supplier,{
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
            }
        }
    }),
    purchase: sequelize.define("purchase",purchaseSchema,{
        freezeTableName: false,
        timestamps: false
    })
}