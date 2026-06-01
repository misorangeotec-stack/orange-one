import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/core/platform/auth";
import { PlatformDirectoryProvider } from "@/core/platform/store";
import { SessionProvider } from "@/core/platform/session";
import "./index.css";
import "./styles/landing.css";

// Portal-wide providers wrap everything (launcher + admin + every app). React Query
// caches server data; Auth gates entry; the directory loads live (keyed off the
// authed user) and the session derives the current user from it.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <PlatformDirectoryProvider>
            <SessionProvider>
              <App />
            </SessionProvider>
          </PlatformDirectoryProvider>
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
);
