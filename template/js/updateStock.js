require("../js/common.js")(document)
document.querySelector("form").addEventListener("submit",e=>{
    e.preventDefault();
    let {"0":{value:name},"1":{value:quantity},"2":{value:price},"3":{value:location}} = e.target;
    console.log({name,quantity,price,location})
})