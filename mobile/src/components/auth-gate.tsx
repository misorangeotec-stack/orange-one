/**
 * Login + access gate. Login is required AND the user must be allowed to use the
 * mobile app (admins always; others need the 'mobile-app' module grant):
 *   - while the initial session check runs → render nothing (splash covers it)
 *   - no session → the AuthScreen
 *   - signed in, access unknown → a brief "checking access" spinner
 *   - signed in, no access → the NoAccessScreen (with Sign out)
 *   - signed in + access → the app (tabs)
 */

import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AuthScreen } from '@/components/auth-screen';
import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';

export function AuthGate({ children }: { children: ReactNode }) {
  const { session, initializing, hasAppAccess } = useAuth();

  if (initializing) return null;
  if (!session) return <AuthScreen />;
  if (hasAppAccess === null) return <Checking />;
  if (hasAppAccess === false) return <NoAccessScreen />;
  return <>{children}</>;
}

function Checking() {
  const theme = useTheme();
  return (
    <View style={[styles.center, { backgroundColor: theme.background }]}>
      <ActivityIndicator color={Brand.orange} />
    </View>
  );
}

function NoAccessScreen() {
  const theme = useTheme();
  const { user, signOut } = useAuth();
  return (
    <View style={[styles.center, { backgroundColor: theme.background, padding: Spacing.five }]}>
      <View style={[styles.badge, { backgroundColor: Brand.orangeSoft }]}>
        <Ionicons name="lock-closed-outline" size={40} color={Brand.orange} />
      </View>
      <ThemedText type="subtitle" style={styles.title}>
        No mobile access yet
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.body}>
        Your Orange One account{user?.email ? ` (${user.email})` : ''} isn’t enabled for the mobile
        app. Ask an admin to grant you the “Mobile App” module in the Orange One portal, then sign
        in again.
      </ThemedText>
      <Pressable onPress={() => signOut()} style={[styles.btn, { backgroundColor: Brand.orange }]}>
        <Ionicons name="log-out-outline" size={18} color="#ffffff" />
        <ThemedText style={styles.btnText}>Sign out</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  badge: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  title: { textAlign: 'center' },
  body: { textAlign: 'center', maxWidth: 340, lineHeight: 20 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.three, paddingHorizontal: Spacing.five, borderRadius: Spacing.three, marginTop: Spacing.two },
  btnText: { color: '#ffffff', fontWeight: '700', fontSize: 15 },
});
