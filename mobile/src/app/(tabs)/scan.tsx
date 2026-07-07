/**
 * Scan tab — quick entry points to capture a lead. Opens the card camera or the
 * manual form. QR / NFC are Phase 2 placeholders.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function ScanScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.three }]}>
      <View style={styles.inner}>
        <ThemedText type="subtitle">Capture</ThemedText>

        <Tile icon="scan" title="Scan business card" subtitle="Front & back — auto-fills the details" onPress={() => router.push('/capture/camera')} primary />
        <Tile icon="create-outline" title="Add manually" subtitle="Type in the details yourself" onPress={() => router.push('/contact/new')} />
        <Tile icon="qr-code-outline" title="Scan QR code" subtitle="Coming in Phase 2" disabled />
        <Tile icon="wifi-outline" title="NFC tap" subtitle="Coming in Phase 2" disabled />
      </View>
    </ScrollView>
  );
}

function Tile({
  icon,
  title,
  subtitle,
  onPress,
  primary,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress?: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: primary ? Brand.navy : theme.backgroundElement, borderColor: theme.border },
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}>
      <View style={[styles.iconTile, { backgroundColor: primary ? 'rgba(255,255,255,0.15)' : Brand.orangeSoft }]}>
        <Ionicons name={icon} size={24} color={primary ? '#ffffff' : Brand.orange} />
      </View>
      <View style={{ flex: 1 }}>
        <ThemedText type="smallBold" style={{ color: primary ? '#ffffff' : theme.text }}>{title}</ThemedText>
        <ThemedText type="small" style={{ color: primary ? 'rgba(255,255,255,0.7)' : theme.textSecondary }}>{subtitle}</ThemedText>
      </View>
      {!disabled ? <Ionicons name="chevron-forward" size={20} color={primary ? '#ffffff' : theme.textSecondary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, alignItems: 'center' },
  inner: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.three },
  tile: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three },
  iconTile: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
});
