

async function connectRegServer(){
    let url = new URL("http://localhost:3000/");
    url.pathname = "/auth/register";
    url.searchParams.set("gst",gst);
    let res = await fetch(url);
    if(!res.ok) throw new Error(res.statusText);
    let data = Buffer.from((await res.body.getReader().read()).value).toString();
}