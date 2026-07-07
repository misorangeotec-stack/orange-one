/**
 * Add sheet — opened by the center + FAB. Two ways to create a lead: scan a
 * business card (camera) or enter details manually.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function AddSheet() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <Pressable style={styles.backdrop} onPress={() => router.back()} />
      <View style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: insets.bottom + Spacing.four }]}>
        <View style={styles.handle} />
        <ThemedText type="smallBold" style={styles.title}>
          Add a lead
        </ThemedText>

        <Option
          icon="scan"
          title="Scan business card"
          subtitle="Capture front & back — details auto-fill"
          onPress={() => router.replace('/capture/camera')}
        />
        <Option
          icon="create-outline"
          title="Add manually"
          subtitle="Type in the person & company details"
          onPress={() => router.replace('/contact/new')}
        />

        <Pressable onPress={() => router.back()} style={styles.cancel}>
          <ThemedText themeColor="textSecondary">Cancel</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function Option({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.option, { backgroundColor: theme.backgroundElement, borderColor: theme.border }, pressed && styles.pressed]}>
      <View style={[styles.iconTile, { backgroundColor: Brand.orangeSoft }]}>
        <Ionicons name={icon} size={24} color={Brand.orange} />
      </View>
      <View style={{ flex: 1 }}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {subtitle}
        </ThemedText>
      </View>
      <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    padding: Spacing.three,
    gap: Spacing.two + 2,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(100,116,139,0.4)', marginBottom: Spacing.one },
  title: { paddingHorizontal: Spacing.one },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  pressed: { opacity: 0.7 },
  iconTile: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cancel: { alignItems: 'center', paddingVertical: Spacing.two, marginTop: Spacing.one },
});
