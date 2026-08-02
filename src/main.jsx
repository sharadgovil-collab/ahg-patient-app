import React from "react";
import ReactDOM from "react-dom/client";
import "./storage-polyfill.js";
import App from "./App.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {
      // service worker registration failed -- app still works, just without offline support
    });
  });
}
