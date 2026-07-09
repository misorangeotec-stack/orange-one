/**
 * Settings — trimmed to the essentials at the client's request: just the ACCOUNT
 * section and a Version row under GENERAL. The MASTERS / MANAGE / PREFERENCES
 * sections (and the GENERAL help rows) are kept in this file but hidden behind the
 * SHOW_* flags below, so any of them can be shown again by flipping a flag to true
 * once we're told what's needed. Nothing is deleted — only hidden.
 */

import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListRow } from '@/components/leads/ListRow';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { MASTER_LABELS } from '@/lib/leads/masters';
import { useLeads } from '@/lib/leads/store';
import type { MasterType } from '@/lib/leads/types';

// Hidden for now — flip to true to bring a section back. Typed `boolean` so the
// kept-but-hidden JSX stays type-checked and ready to restore.
const SHOW_MASTERS: boolean = false;
const SHOW_MANAGE: boolean = false;
const SHOW_PREFERENCES: boolean = false;
const SHOW_HELP: boolean = false; // "Contact support" + "Help center" under GENERAL

export default function SettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { masters, syncing, pendingCount, lastSyncedAt, syncError, syncNow } = useLeads();
  const { user, signOut } = useAuth();

  const soon = () => Alert.alert('Coming soon', 'This will be available in a later phase.');
  const masterTypes: MasterType[] = ['categories', 'interestLevels', 'askedAbout', 'followUpActions'];

  const pending = pendingCount;
  const syncValue = syncing && pending > 0 ? 'Syncing…' : pending > 0 ? `${pending} pending` : 'All synced';
  const lastSynced = lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
  const confirmSignOut = () => {
    const unsynced =
      pending > 0
        ? `\n\n${pending} ${pending === 1 ? 'lead has' : 'leads have'} not uploaded yet. They stay on this device and will be waiting when you sign back in.`
        : '';
    Alert.alert('Sign out', `Sign out of Orange One Leads on this device?${unsynced}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.three }]}>
      <View style={styles.inner}>
        <ThemedText type="subtitle">Settings</ThemedText>

        <Section title="ACCOUNT">
          <ListRow icon="person-circle-outline" label="Signed in" value={user?.email ?? '—'} />
          <ListRow icon="sync-outline" label="Sync now" value={syncValue} onPress={syncNow} />
          <ListRow icon="time-outline" label="Last synced" value={lastSynced} />
          {syncError ? <ListRow icon="warning-outline" label="Last error" value={syncError} /> : null}
          <ListRow icon="log-out-outline" label="Sign out" onPress={confirmSignOut} last />
        </Section>

        {SHOW_MASTERS && (
          <Section title="MASTERS">
            {masterTypes.map((t, i) => (
              <ListRow
                key={t}
                icon="pricetags-outline"
                label={MASTER_LABELS[t]}
                value={`${masters[t].length}`}
                last={i === masterTypes.length - 1}
              />
            ))}
            <ThemedText type="small" themeColor="textSecondary" style={styles.mastersNote}>
              Managed by your admin in the Orange One portal.
            </ThemedText>
          </Section>
        )}

        {SHOW_MANAGE && (
          <Section title="MANAGE">
            <ListRow icon="git-network-outline" label="Manage intent signals" onPress={soon} />
            <ListRow icon="logo-whatsapp" label="WhatsApp templates" onPress={soon} />
            <ListRow icon="mail-outline" label="Email templates" onPress={soon} />
            <ListRow icon="link-outline" label="Integrations" onPress={soon} last />
          </Section>
        )}

        {SHOW_PREFERENCES && (
          <Section title="PREFERENCES">
            <ListRow icon="lock-closed-outline" label="Permissions" onPress={soon} />
            <ListRow icon="notifications-outline" label="Notifications" onPress={soon} />
            <ListRow icon="language-outline" label="Language" value="English" onPress={soon} last />
          </Section>
        )}

        <Section title="GENERAL">
          {SHOW_HELP && (
            <>
              <ListRow icon="chatbubble-ellipses-outline" label="Contact support" onPress={soon} />
              <ListRow icon="help-circle-outline" label="Help center" onPress={soon} />
            </>
          )}
          <ListRow icon="information-circle-outline" label="Version" value="0.1.0 (Phase 1)" last />
        </Section>
      </View>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.sectionTitle}>{title}</ThemedText>
      <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, alignItems: 'center' },
  inner: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.three },
  section: { gap: Spacing.one },
  sectionTitle: { paddingHorizontal: Spacing.two, letterSpacing: 0.5 },
  card: { borderWidth: 1, borderRadius: Spacing.three, overflow: 'hidden' },
  mastersNote: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
});
