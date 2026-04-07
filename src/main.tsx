import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initAgentPort } from "./services/port";
import "./App.css";

void initAgentPort().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
