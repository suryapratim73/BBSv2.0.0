const { ipcRenderer } = require("electron");

ipcRenderer.invoke("get-kiosk-info").then(function (info) {
    if (!info || !info.running) {
        document.querySelector(".kiosk-modal").innerHTML =
            '<h2 style="color:red;text-align:center;">Kiosk is not running</h2>';
        return;
    }
    var url = "http://" + info.ip + ":" + info.port;
    document.getElementById("km-url").textContent = url;
    document.getElementById("km-pin").textContent = info.pin || "1234";

    // Generate QR code from URL
    var QRCode = require("qrcode");
    QRCode.toDataURL(url, { width: 180, margin: 1 }, function (err, dataUrl) {
        if (!err) document.getElementById("km-qr").src = dataUrl;
    });
});

document.getElementById("km-stop-btn").addEventListener("click", function () {
    ipcRenderer.send("toggle-kiosk-from-modal", "stop");
    window.close();
});

document.getElementById("km-close-btn").addEventListener("click", function () {
    window.close();
});
