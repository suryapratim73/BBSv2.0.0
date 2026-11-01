const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { app } = require("electron");

const { getPythonExecutablePath } = require("./common");

exports.startPythonProcess = async function(){
    return;
    const path2python = getPythonExecutablePath();
    const path2main_py = path.resolve(__dirname,"py/main.py");
    if(!fs.existsSync(path2python) || !fs.existsSync(path2main_py)){
        console.log("Paths don't exists");
        return;
    }
    // Same path logic as model/dbConfig.js: DEV -> project root, else
    // appData/BBS. The Python side reads these (py/config/settings.py) so it
    // never has to guess where the DB and schema files live.
    const appPath = process.env.APP_ENV === "DEV"
        ? path.resolve(__dirname)
        : path.resolve(app.getPath("appData"), "./BBS");
    // Preparing the
    const proc = spawn(path2python, [
        "-m",
        "uvicorn",
        "main:app",
        "--host",
        "127.0.0.1",
        "--port",
        "8000"
    ], {
        stdio: "pipe",
        cwd:path.resolve(__dirname,"py"),
        env: {
            ...process.env,
            BBS_APP_PATH: appPath,
            BBS_DB_PATH: path.join(appPath, "db", "bbs.db"),
        }
    });
    proc.stdout.on("data", (data) => {
        console.log(`[py] ${data}`);
    });
    proc.stderr.on("data", (data) => {
        console.log(`[py:err] ${data}`);
    });
    proc.on("error", (err) => {
        console.log(err);
    });
    proc.on("exit", (code) => {
        console.log(`[py] exited with code ${code}`);
    });
}