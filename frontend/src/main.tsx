import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { getPersister, PERSIST_BUSTER, PERSIST_MAX_AGE } from "./queryPersister";
import ErrorBoundary from "@/core/platform/ErrorBoundary";
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
const persister = getPersister();
const PERSISTED_QUERY_ROOTS = new Set([
  "appData", // receivables hub payload
  "taskData", // task-management: tasks + activity + recurring + locations
  "taskNotifications", // task-management: the bell feed (also rendered on /home)
  "orgPeople", // task-management: org people directory
  "directory", // platform directory (profiles/roles/hods/app_access)
  // Order to Dispatch CATALOGUE — customers, items and the pairs between them.
  // ⚠ THE DISPATCH WORKING SET IS DELIBERATELY ABSENT. Persisting orders would let
  //   a queue paint a stale stage for a moment after a reload; the catalogue cannot
  //   mislead anyone that way, and it is the 2 MB worth keeping. The key name must
  //   match DISPATCH_MASTERS_QK — rename one and the other silently stops working.
  "dispatchMasters",
]);

/**
 * A `["directory", …]` payload with no profiles in it must never reach disk.
 *
 * `profiles` is RLS'd, so a read that went out without the user's token comes
 * back as HTTP 200 with `[]` — a "successful" query holding nothing. Persisting
 * that would restore an empty directory on every load for the full 24-hour max
 * age, turning one unlucky read into a permanent one. PlatformDirectoryProvider
 * already re-reads when its own row is missing; this stops the bad payload
 * outliving the tab in the first place.
 */
function isEmptyDirectory(query: { queryKey: readonly unknown[]; state: { data?: unknown } }): boolean {
  if (query.queryKey[0] !== "directory") return false;
  const data = query.state.data as { profiles?: unknown[] } | undefined;
  return !data?.profiles?.length;
}

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
              PERSISTED_QUERY_ROOTS.has(query.queryKey[0]) &&
              !isEmptyDirectory(query),
          },
        }}
      >
        {/*
          The boundary sits INSIDE the query + router providers and OUTSIDE the
          app, so a crash anywhere in a screen still renders a message with the
          page chrome's tokens available — and so no screen can ever again
          unmount the whole tree into a blank white page.
        */}
        <ErrorBoundary>
          <AuthProvider>
            <PlatformDirectoryProvider>
              <SessionProvider>
                <App />
              </SessionProvider>
            </PlatformDirectoryProvider>
          </AuthProvider>
        </ErrorBoundary>
      </PersistQueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
);
