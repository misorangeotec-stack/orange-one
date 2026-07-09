/**
 * Decides WHEN to run a sync cycle (the flush/pull lives in LeadsProvider).
 * Deliberately quiet — NOT a live/continuous sync:
 *   - once on login / ready (cold start with a cached session)
 *   - the moment connectivity returns after being offline, with no tap required
 *   - when the app is brought back to the foreground while online
 * Data changes trigger their own push (debounced) from the store, so there is no
 * need to sync on every render — that felt "live".
 * Expo Go SDK 54 safe: netinfo is bundled in Expo Go.
 */

import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { useEffect } from 'react';
import { AppState } from 'react-native';

type SyncReason = 'start' | 'reconnect' | 'foreground';

/**
 * Usable internet. `isInternetReachable` is null while Android is still probing,
 * and briefly false right after airplane mode goes off — treat only an explicit
 * false as "no internet", and require an actual connection.
 */
const isOnline = (s: NetInfoState): boolean => s.isConnected === true && s.isInternetReachable !== false;

export function useSync(
  userId: string | null,
  ready: boolean,
  runSync: (reason: SyncReason) => void,
  /** Stable getter — read at call time so this hook never resubscribes on a count change. */
  hasPendingWork: () => boolean
) {
  useEffect(() => {
    if (userId && ready) runSync('start');
  }, [userId, ready, runSync]);

  useEffect(() => {
    if (!userId) return;

    // Seeded from the first event NetInfo delivers on subscribe, not assumed
    // online: launching the app in airplane mode used to leave this at `true`,
    // so the later offline→online edge never registered and nothing auto-synced.
    let wasOnline: boolean | null = null;

    const unsubscribeNet = NetInfo.addEventListener((state) => {
      const online = isOnline(state);
      // Fires on the rising edge only. Android emits several events while it
      // probes (connected/unknown → connected/reachable); this collapses them
      // into a single sync, and `syncingRef` in the store guards any overlap.
      if (online && wasOnline === false) runSync('reconnect');
      wasOnline = online;
    });

    const subscriptionApp = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !hasPendingWork()) return;
      // Coming back to the app is the other moment a stalled outbox should retry:
      // connectivity may have returned while we were backgrounded and no NetInfo
      // event was delivered. Only when something is actually waiting to go up —
      // otherwise every app-resume would trigger a pull.
      NetInfo.fetch()
        .then((s) => {
          if (isOnline(s)) runSync('foreground');
        })
        .catch(() => {});
    });

    return () => {
      unsubscribeNet();
      subscriptionApp.remove();
    };
  }, [userId, runSync, hasPendingWork]);
}
