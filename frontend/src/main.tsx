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

// Persist the heavy server datasets to IndexedDB so new tabs / reloads hydrate
// instantly instead of re-fetching everything, then revalidate in the background.
// Opening a task (or a receivables customer) in a new tab used to cold-fetch the
// whole dataset again; these query roots already reach the browser today, so
// persisting them changes nothing about data exposure — it just avoids the
// re-download. Anything not listed (auth session, etc.) stays session-fresh.
const persister = createIDBPersister();
const PERSISTED_QUERY_ROOTS = new Set([
  "appData", // receivables hub payload
  "taskData", // task-management: tasks + activity + recurring + locations
  "orgPeople", // task-management: org people directory
  "directory", // platform directory (profiles/roles/hods/app_access)
]);

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
              query.state.status === "success" &&
              typeof query.queryKey[0] === "string" &&
              PERSISTED_QUERY_ROOTS.has(query.queryKey[0]),
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
