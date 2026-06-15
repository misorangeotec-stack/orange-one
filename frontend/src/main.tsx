import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createIDBPersister, PERSIST_BUSTER, PERSIST_MAX_AGE } from "./queryPersister";
import { AuthProvider } from "@/core/platform/auth";
import { PlatformDirectoryProvider } from "@/core/platform/store";
import { SessionProvider } from "@/core/platform/session";
import "./index.css";
import "./styles/landing.css";

// Portal-wide providers wrap everything (launcher + admin + every app). React Query
// caches server data; Auth gates entry; the directory loads live (keyed off the
// authed user) and the session derives the current user from it.
//
// gcTime is bumped to match PERSIST_MAX_AGE so a restored-but-not-yet-observed
// query isn't garbage-collected before its page mounts.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, gcTime: PERSIST_MAX_AGE, retry: 1, refetchOnWindowFocus: false },
  },
});

// Persist the heavy receivables dataset to IndexedDB so new tabs / reloads hydrate
// instantly instead of re-fetching everything. Only the `appData` query is
// persisted (auth/directory stay session-fresh and re-validate per login).
const persister = createIDBPersister();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: PERSIST_MAX_AGE,
          buster: PERSIST_BUSTER,
          dehydrateOptions: {
            shouldDehydrateQuery: (query) =>
              query.state.status === "success" && query.queryKey[0] === "appData",
          },
        }}
      >
        <AuthProvider>
          <PlatformDirectoryProvider>
            <SessionProvider>
              <App />
            </SessionProvider>
          </PlatformDirectoryProvider>
        </AuthProvider>
      </PersistQueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
);
