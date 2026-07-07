/**
 * Photo capture/pick field with thumbnail grid + remove. Used for the person
 * photo, business-card images, and future-reminder photos.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { capturePhoto, pickPhoto } from '@/lib/leads/media';

export function PhotoField({
  label,
  photos,
  onChange,
  max = 6,
}: {
  label: string;
  photos: string[];
  onChange: (next: string[]) => void;
  max?: number;
}) {
  const theme = useTheme();

  const add = () => {
    Alert.alert(label, 'Add a photo', [
      { text: 'Take photo', onPress: async () => { const uri = await capturePhoto(); if (uri) onChange([...photos, uri]); } },
      { text: 'Choose from gallery', onPress: async () => { const uri = await pickPhoto(); if (uri) onChange([...photos, uri]); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const remove = (uri: string) => onChange(photos.filter((p) => p !== uri));

  return (
    <View style={styles.wrap}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
        {label}
      </ThemedText>
      <View style={styles.grid}>
        {photos.map((uri) => (
          <View key={uri} style={styles.thumb}>
            <Image source={{ uri }} style={styles.thumbImg} contentFit="cover" />
            <Pressable onPress={() => remove(uri)} hitSlop={6} style={styles.removeBtn}>
              <Ionicons name="close" size={14} color="#ffffff" />
            </Pressable>
          </View>
        ))}
        {photos.length < max ? (
          <Pressable onPress={add} style={[styles.addTile, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
            <Ionicons name="camera" size={22} color={Brand.orange} />
            <ThemedText type="small" themeColor="textSecondary">
              Add
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  label: { paddingHorizontal: Spacing.half },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  thumb: { width: 76, height: 76, borderRadius: Spacing.two, overflow: 'hidden' },
  thumbImg: { width: 76, height: 76 },
  removeBtn: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTile: {
    width: 76,
    height: 76,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
});
