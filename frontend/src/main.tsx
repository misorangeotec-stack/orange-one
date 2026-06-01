import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { PlatformDirectoryProvider } from "@/core/platform/store";
import { SessionProvider } from "@/core/platform/session";
import "./index.css";
import "./styles/landing.css";

// Portal-wide providers wrap everything (launcher + admin + every app) so they
// share one directory + session. Directory is outermost so the session's current
// user reflects live identity edits.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <PlatformDirectoryProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </PlatformDirectoryProvider>
    </BrowserRouter>
  </React.StrictMode>
);
