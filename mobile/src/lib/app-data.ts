/**
 * Thin typed data helpers over the Supabase client. These prove the end-to-end
 * plumbing for the scaffold:
 *   - `fetchMyProfile` — a typed, RLS-scoped READ of existing Orange One data.
 *   - `registerDevice` — an upsert WRITE into the new `app_`-prefixed table.
 * Real feature data access lands here (or in feature-specific libs) later.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { Database } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

export type Profile = Database['public']['Tables']['profiles']['Row'];
export type AppDevice = Database['public']['Tables']['app_devices']['Row'];

const DEVICE_ID_KEY = 'orange-one.device_id.v1';

/** The signed-in user's profile row (name/designation/email). RLS scopes it. */
export async function fetchMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** A stable per-install id, generated once and cached in AsyncStorage. */
export async function getDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  // Simple random id (no native UUID dependency needed for a device tag).
  const id = `${Platform.OS}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

/** Register / refresh this device against the signed-in user (upsert). */
export async function registerDevice(): Promise<AppDevice> {
  const deviceId = await getDeviceId();
  const row: Database['public']['Tables']['app_devices']['Insert'] = {
    device_id: deviceId,
    platform: Platform.OS,
    model: (Constants.deviceName as string | null) ?? null,
    app_version: (Constants.expoConfig?.version as string | undefined) ?? null,
    last_seen_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('app_devices')
    .upsert(row, { onConflict: 'user_id,device_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}
