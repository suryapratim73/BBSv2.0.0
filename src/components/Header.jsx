import React from "react";
import "../css/Header.css";

export default function Header(){
    return (
        <div className="app-header">
            <div id="brand-box">
                <p>
                    <strong>B</strong>
                    hagawati &nbsp;
                    <strong>B</strong>
                    uisness &nbsp;
                    <strong>S</strong>
                    olution &nbsp;
                </p>
                <span>v2.0.0</span>
            </div>
            <p className="username">Usha Hardware Stores</p>
        </div>
    )
}