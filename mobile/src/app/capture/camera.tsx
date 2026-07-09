/**
 * Business-card camera. Captures front (and optional back), auto-crops each shot
 * to the on-screen alignment frame, then hands the card image(s) to the Review
 * card screen. Extraction is deferred to the background sync (never blocks here),
 * so capture is instant whether online or offline.
 */

import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/Button';
import { Spacing } from '@/constants/theme';
import type { CapturedImage } from '@/lib/leads/extractCard';
import { cropToFrame, FRAME_ASPECT, FRAME_WIDTH_RATIO, pickImageData, warmLocation } from '@/lib/leads/media';
import { setPendingScan } from '@/lib/leads/pendingScan';
import { emptyDraft } from '@/lib/leads/types';

type Step = 'front' | 'review';

export default function CameraScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const [step, setStep] = useState<Step>('front');
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [front, setFront] = useState<CapturedImage | null>(null);
  const [back, setBack] = useState<CapturedImage | null>(null);

  // The camera is on screen for a few seconds before Review renders — the cheapest
  // moment to get a location fix warm, so saving never has to wait for one.
  useEffect(() => warmLocation(), []);

  const goManual = () => router.replace('/contact/new');

  // Always defer: hand the (cropped) card image(s) to the Review screen and let
  // the background sync read the card. No live extraction, no loading screen.
  const finish = (frontImg: CapturedImage | null, backImg: CapturedImage | null) => {
    setPendingScan({
      ...emptyDraft(),
      cardImages: { front: frontImg?.uri ?? null, back: backImg?.uri ?? null },
      pendingExtract: true,
    });
    router.replace({ pathname: '/contact/review', params: { scanned: '1' } });
  };

  const takePhoto = async () => {
    try {
      const pic = await cameraRef.current?.takePictureAsync({ quality: 0.6, base64: true });
      if (!pic?.uri) return;
      // Crop to just the card inside the alignment frame (best-effort).
      const cropped = await cropToFrame({ uri: pic.uri, width: pic.width, height: pic.height, base64: pic.base64 });
      const img: CapturedImage = { uri: cropped.uri, base64: cropped.base64 };
      if (side === 'front') setFront(img);
      else setBack(img);
      setStep('review');
    } catch {
      /* ignore */
    }
  };

  const fromGallery = async () => {
    const img = await pickImageData();
    if (!img) return;
    if (side === 'front') setFront(img);
    else setBack(img);
    setStep('review');
  };

  // Permission gate
  if (!permission) return <View style={styles.black} />;
  if (!permission.granted) {
    return (
      <View style={[styles.black, styles.center, { padding: Spacing.four }]}>
        <Ionicons name="camera-outline" size={48} color="#ffffff" />
        <ThemedText style={styles.permText}>Camera access is needed to scan business cards.</ThemedText>
        <Button label="Grant camera access" onPress={requestPermission} />
        <Pressable onPress={goManual} style={{ marginTop: Spacing.three }}>
          <ThemedText style={{ color: '#ffffff' }}>Add manually instead</ThemedText>
        </Pressable>
        <Pressable onPress={() => router.back()} style={{ marginTop: Spacing.two }}>
          <ThemedText style={{ color: 'rgba(255,255,255,0.7)' }}>Cancel</ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.black}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.two }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={26} color="#ffffff" />
        </Pressable>
        <ThemedText style={styles.topTitle}>
          {side === 'front' ? 'Scan front of card' : 'Scan back of card'}
        </ThemedText>
        <View style={{ width: 26 }} />
      </View>

      {/* Framing guides */}
      <View style={styles.frameWrap} pointerEvents="none">
        <View style={[styles.frame, { width: `${FRAME_WIDTH_RATIO * 100}%`, aspectRatio: FRAME_ASPECT }]} />
        <ThemedText style={styles.frameHint}>Align the card within the frame</ThemedText>
      </View>

      {/* Review controls */}
      {step === 'review' ? (
        <View style={[styles.reviewBar, { paddingBottom: insets.bottom + Spacing.three }]}>
          <View style={styles.thumbs}>
            {front ? <Image source={{ uri: front.uri }} style={styles.thumb} contentFit="cover" /> : null}
            {back ? <Image source={{ uri: back.uri }} style={styles.thumb} contentFit="cover" /> : null}
          </View>
          <View style={styles.reviewBtns}>
            {!back ? (
              <Button
                label="Add back side"
                variant="secondary"
                icon="add"
                onPress={() => { setSide('back'); setStep('front'); }}
                style={styles.flexBtn}
              />
            ) : null}
            <Button label="Continue" icon="checkmark" onPress={() => finish(front, back)} style={styles.flexBtn} />
          </View>
        </View>
      ) : (
        /* Capture controls */
        <View style={[styles.controls, { paddingBottom: insets.bottom + Spacing.three }]}>
          <View style={styles.modeRow}>
            <ThemedText style={[styles.mode, styles.modeActive]}>Single</ThemedText>
            <Pressable onPress={goManual}>
              <ThemedText style={styles.mode}>Manual</ThemedText>
            </Pressable>
          </View>
          <View style={styles.shutterRow}>
            <Pressable onPress={fromGallery} style={styles.sideBtn}>
              <Ionicons name="images-outline" size={24} color="#ffffff" />
            </Pressable>
            <Pressable onPress={takePhoto} style={styles.shutter}>
              <View style={styles.shutterInner} />
            </Pressable>
            <Pressable onPress={goManual} style={styles.sideBtn}>
              <Ionicons name="create-outline" size={24} color="#ffffff" />
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  black: { flex: 1, backgroundColor: '#000000' },
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  permText: { color: '#ffffff', textAlign: 'center' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    zIndex: 2,
  },
  topTitle: { color: '#ffffff', fontWeight: '700' },
  frameWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  frame: {
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    borderRadius: Spacing.three,
  },
  frameHint: { color: 'rgba(255,255,255,0.85)' },
  controls: { position: 'absolute', bottom: 0, left: 0, right: 0, gap: Spacing.four, paddingTop: Spacing.three },
  modeRow: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.four },
  mode: { color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
  modeActive: { color: '#ffffff', textDecorationLine: 'underline' },
  shutterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: Spacing.five },
  sideBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  shutter: { width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#ffffff' },
  reviewBar: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: Spacing.three, gap: Spacing.three, backgroundColor: 'rgba(0,0,0,0.55)' },
  thumbs: { flexDirection: 'row', gap: Spacing.two, justifyContent: 'center' },
  thumb: { width: 84, height: 54, borderRadius: Spacing.one, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  reviewBtns: { flexDirection: 'row', gap: Spacing.two },
  flexBtn: { flex: 1 },
});
