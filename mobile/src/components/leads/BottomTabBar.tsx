/**
 * Custom bottom tab bar with a raised center "+" FAB (matches the reference app).
 * Passed to expo-router's <Tabs tabBar={...}>. The FAB is not a route — it opens
 * the Add sheet (/add). Real tabs: index (Home), reminders, scan, settings.
 */

import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const ICONS: Record<string, { on: keyof typeof Ionicons.glyphMap; off: keyof typeof Ionicons.glyphMap; label: string }> = {
  index: { on: 'home', off: 'home-outline', label: 'Home' },
  reminders: { on: 'alarm', off: 'alarm-outline', label: 'Reminders' },
  scan: { on: 'scan', off: 'scan-outline', label: 'Scan' },
  settings: { on: 'settings', off: 'settings-outline', label: 'Settings' },
};

// Visual order with the FAB slot in the middle.
const LEFT = ['index', 'reminders'];
const RIGHT = ['scan', 'settings'];

// Tabs that are shipped but not enabled yet: shown grayscale + a lock badge and
// not tappable. Remove a name here to turn the tab back on.
const LOCKED = new Set(['reminders']);

export function BottomTabBar({ state, navigation }: BottomTabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const activeName = state.routes[state.index]?.name;

  const renderTab = (name: string) => {
    const meta = ICONS[name];
    if (!meta) return <View key={name} style={styles.tab} />;
    const focused = activeName === name;

    // Locked tab: grayscale, a small lock badge, and no navigation on tap.
    if (LOCKED.has(name)) {
      return (
        <View key={name} style={[styles.tab, styles.locked]} accessibilityState={{ disabled: true }}>
          <View>
            <Ionicons name={meta.off} size={24} color={theme.textSecondary} />
            <View style={[styles.lockBadge, { backgroundColor: theme.backgroundElement }]}>
              <Ionicons name="lock-closed" size={11} color={theme.textSecondary} />
            </View>
          </View>
          <ThemedText type="small" style={{ color: theme.textSecondary, fontSize: 11 }}>
            {meta.label}
          </ThemedText>
        </View>
      );
    }

    return (
      <Pressable
        key={name}
        style={styles.tab}
        onPress={() => {
          const event = navigation.emit({ type: 'tabPress', target: state.routes.find((r) => r.name === name)?.key ?? name, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(name as never);
        }}>
        <Ionicons name={focused ? meta.on : meta.off} size={24} color={focused ? Brand.orange : theme.textSecondary} />
        <ThemedText type="small" style={{ color: focused ? Brand.orange : theme.textSecondary, fontSize: 11 }}>
          {meta.label}
        </ThemedText>
      </Pressable>
    );
  };

  return (
    <View style={[styles.bar, { backgroundColor: theme.backgroundElement, borderTopColor: theme.border, paddingBottom: insets.bottom || Spacing.two }]}>
      {LEFT.map(renderTab)}

      <View style={styles.fabSlot}>
        <Pressable
          onPress={() => router.push('/add')}
          style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}>
          <Ionicons name="add" size={32} color="#ffffff" />
        </Pressable>
      </View>

      {RIGHT.map(renderTab)}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  locked: { opacity: 0.4 },
  lockBadge: {
    position: 'absolute',
    right: -6,
    top: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabSlot: { width: 72, alignItems: 'center', justifyContent: 'center' },
  fab: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Brand.orange,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -28,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabPressed: { opacity: 0.85 },
});
