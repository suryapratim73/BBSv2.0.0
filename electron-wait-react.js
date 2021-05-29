const net = require("net");

process.env.ELECTRON_START_URL = `http://localhost:5000`;

const client = new net.Socket();

let startedElectron = false;
const tryConnection = () => client.connect({port: 5000}, () => {
        client.end();
        if(!startedElectron) {
            console.log('starting electron');
            const exec = require('child_process').exec;
            let bbsDevScript = exec('npm run bbsDev')
            bbsDevScript.stdout.on("data",console.log);
            bbsDevScript.stderr.on("data",console.error)
            startedElectron = true;
        }
    }
);

tryConnection();

client.on('error', (error) => {
    setTimeout(tryConnection, 1000);
});