exports.init = function(DataTypes,UUIDV4){
    return{
        supplier : {
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
        },
        freight : {
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
        },
        people : {
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
        },
        customerSchema : {
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
        },
        stockSchema : {
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
        },
        serviceSchema : {
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
        },
        purchaseSchema : {
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
        },
        saleSchema : {
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
            },
            billformonth:{
                type:DataTypes.TEXT
            }
        },
        outPaymentSchema : {
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
        },
        inPaymentSchema : {
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
        },
        returnRegister : {
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
        },
        attendanceSchema : {
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
        },
        requirementSchema : {
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
        },
        userSchema : {
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
        },
        financialRecordSchema : {
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
    }
}