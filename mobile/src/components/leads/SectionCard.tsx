import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A titled, tinted container that groups related form fields (Person / Company). */
export function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { borderColor: theme.border, backgroundColor: Brand.orangeSoft }]}>
      <View style={styles.titleWrap}>
        <ThemedText type="smallBold" style={{ color: Brand.navy }}>
          {title}
        </ThemedText>
      </View>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.three },
  titleWrap: { marginBottom: -Spacing.one },
  body: { gap: Spacing.two + 2 },
});
