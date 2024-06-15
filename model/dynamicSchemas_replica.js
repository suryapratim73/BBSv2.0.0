exports.init = function(DataTypes){
    return {
        supplierLedgerSchema : {
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
            tax:{
                type:DataTypes.INTEGER
            },
            paymentStatus:{
                type:DataTypes.BOOLEAN
            },
            payments:{
                type:DataTypes.INTEGER,
                defaultValue:0
            },
            balance:{
                type:DataTypes.INTEGER,
                defaultValue:0
            },
            itemList:{
                type:DataTypes.TEXT
            },
            returnable:{
                type: DataTypes.BOOLEAN,
                defaultValue: true
            }
        },
        customerLedgerSchema : {
            entryNo:{
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            billStatus:{
                type:DataTypes.BOOLEAN
            },
            date:{
                type:DataTypes.DATE
            },
            billNo:{
                type:DataTypes.INTEGER
            },
            billAmt:{
                type:DataTypes.INTEGER
            },
            tax:{
                type:DataTypes.INTEGER
            },
            paymentStatus:{
                type:DataTypes.BOOLEAN
            },
            payments:{
                type:DataTypes.INTEGER,
            },
            netDue:{
                type:DataTypes.INTEGER,
                defaultValue:0
            },
            itemList:{
                type:DataTypes.TEXT
            },
            delivery:{
                type:DataTypes.JSON,
                defaultValue:"hand"
            },
            balance:{
                type:DataTypes.INTEGER,
                defaultValue:0
            },
            returnable:{
                type: DataTypes.BOOLEAN,
                defaultValue: true
            }
        },
        billItemSchema : {
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
                type: DataTypes.NUMBER
            },
            sgst:{
                type: DataTypes.NUMBER
            },
            cgst:{
                type: DataTypes.NUMBER
            },
            igst:{
                type: DataTypes.NUMBER
            },
            itemReturned:{
                type: DataTypes.BOOLEAN,
                defaultValue: false
            }
        }
    }
}
