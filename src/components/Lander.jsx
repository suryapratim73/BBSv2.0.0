import React, { useEffect, useRef } from "react";
import Header from "./Header";
import "../css/Lander.css";

export default function Lander(){
    
    return (
        <div className="lander-content-container">
            <Header />
            <div id="notification-panel">
                <h1>Notification panel</h1>
            </div>
            <div id="body-panel">
                <div id="order-queue-panel"></div>
            </div>
        </div>
    )
}