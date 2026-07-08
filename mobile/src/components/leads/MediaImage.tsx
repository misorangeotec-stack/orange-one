/**
 * <Image> that transparently resolves a Supabase private-bucket storage path
 * (`lead-media/...`) to a signed URL before rendering; local `file://` / `http`
 * uris pass straight through. Shows a neutral placeholder while a storage path is
 * being signed (or if it can't be), instead of a broken-image flash.
 *
 * Drop-in replacement for expo-image `Image` at any spot that renders a STORED
 * media uri (one that may have come from Supabase on another device / fresh
 * install). See use-media-url.ts for why this is needed.
 */

import { Image } from 'expo-image';
import { View } from 'react-native';
import type { ImageStyle, StyleProp, ViewStyle } from 'react-native';

import { useMediaUrl } from '@/hooks/use-media-url';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  uri?: string | null;
  style?: StyleProp<ImageStyle>;
  contentFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
};

export function MediaImage({ uri, style, contentFit = 'cover' }: Props) {
  const theme = useTheme();
  const resolved = useMediaUrl(uri);

  if (!resolved) {
    return <View style={[{ backgroundColor: theme.backgroundElement }, style as unknown as StyleProp<ViewStyle>]} />;
  }
  return <Image source={{ uri: resolved }} style={style} contentFit={contentFit} />;
}
