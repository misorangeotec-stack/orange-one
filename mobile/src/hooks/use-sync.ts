/**
 * Decides WHEN to run a sync cycle (the flush/pull lives in LeadsProvider).
 * Deliberately quiet — NOT a live/continuous sync:
 *   - once on login / ready (cold start with a cached session)
 *   - when connectivity returns after being offline (so offline captures push)
 * Data changes trigger their own push (debounced) from the store, so there is no
 * need to also re-sync every time the app is foregrounded — that felt "live".
 * Expo Go SDK 54 safe: netinfo is bundled in Expo Go.
 */

import NetInfo from '@react-native-community/netinfo';
import { useEffect } from 'react';

type SyncReason = 'start' | 'reconnect';

export function useSync(userId: string | null, ready: boolean, runSync: (reason: SyncReason) => void) {
  useEffect(() => {
    if (userId && ready) runSync('start');
  }, [userId, ready, runSync]);

  useEffect(() => {
    if (!userId) return;
    let wasConnected = true;
    const unsubscribe = NetInfo.addEventListener((state) => {
      const isConnected = state.isConnected !== false;
      if (isConnected && !wasConnected) runSync('reconnect');
      wasConnected = isConnected;
    });
    return unsubscribe;
  }, [userId, runSync]);
}
