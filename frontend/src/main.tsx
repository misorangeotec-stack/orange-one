import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "@/core/platform/auth";
import { PlatformDirectoryProvider } from "@/core/platform/store";
import { SessionProvider } from "@/core/platform/session";
import "./index.css";
import "./styles/landing.css";

// Portal-wide providers wrap everything (launcher + admin + every app). Auth is
// outermost (it gates entry); the directory + session sit inside so they can later
// be keyed off the authenticated user. Directory is outside session so the current
// user reflects live identity edits.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <PlatformDirectoryProvider>
          <SessionProvider>
            <App />
          </SessionProvider>
        </PlatformDirectoryProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
