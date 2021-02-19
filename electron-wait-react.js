const net = require("net");
const { stderr } = require("process");

process.env.ELECTRON_START_URL = `http://localhost:5000`;

const client = new net.Socket();

let startedElectron = false;
const tryConnection = () => client.connect({port: 5000}, () => {
        client.end();
        if(!startedElectron) {
            console.log('starting electron');
            const exec = require('child_process').exec;
            exec('npm run bbsDev').stdout.on("data",console.log).on("error",console.error)
            startedElectron = true;
        }
    }
);

tryConnection();

client.on('error', (error) => {
    setTimeout(tryConnection, 1000);
});