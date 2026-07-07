/**
 * Records a real voice note with expo-audio and hands the parent the uri +
 * duration. Transcription + analysis (Deepgram → Claude via the transcribe-voice
 * Edge Function) is deferred to the background sync so stopping is instant and
 * the UX never blocks — online or offline. Works in Expo Go (SDK 54).
 */

import { Ionicons } from '@expo/vector-icons';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useCallback } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Waveform } from '@/components/leads/Waveform';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDuration, persistMedia } from '@/lib/leads/media';

export type RecordedVoice = {
  uri: string;
  durationMs: number;
  transcript: string | null;
  summary: string | null;
  suggestedInterest: string | null;
  followUps: string[];
  status: 'pending' | 'done' | 'failed';
};

export function VoiceRecorder({ onRecorded }: { onRecorded: (v: RecordedVoice) => void }) {
  const theme = useTheme();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 200);

  const start = useCallback(async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Microphone needed', 'Enable microphone access to record voice notes.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      Alert.alert('Recording failed', 'Could not start recording.');
    }
  }, [recorder]);

  const stop = useCallback(async () => {
    const durationMs = state.durationMillis || 0;
    let rawUri: string | null = null;
    try {
      await recorder.stop();
      rawUri = recorder.uri;
    } catch {
      Alert.alert('Recording failed', 'Could not save the recording.');
      return;
    }
    if (!rawUri) return;
    // Copy to the durable dir so the audio survives until it can be transcribed.
    const uri = persistMedia(rawUri, 'voice');

    // Always defer: transcription + analysis run in the background sync so the UX
    // never blocks. The note is queued 'pending' until the sync engine reads it.
    onRecorded({ uri, durationMs, transcript: null, summary: null, suggestedInterest: null, followUps: [], status: 'pending' });
  }, [recorder, state.durationMillis, onRecorded]);

  if (state.isRecording) {
    return (
      <View style={[styles.wrap, { backgroundColor: theme.backgroundElement, borderColor: Brand.orange }]}>
        <View style={styles.recDot} />
        <Waveform recording />
        <ThemedText type="small" themeColor="textSecondary">
          {formatDuration(state.durationMillis || 0)}
        </ThemedText>
        <Pressable onPress={stop} hitSlop={8} style={styles.stopBtn}>
          <Ionicons name="stop" size={18} color="#ffffff" />
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable onPress={start} style={[styles.wrap, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <ThemedText themeColor="textSecondary" style={styles.hint}>
        Add voice note
      </ThemedText>
      <View style={styles.micBtn}>
        <Ionicons name="mic" size={20} color="#ffffff" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.two + 2,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    minHeight: 60,
  },
  hint: { flex: 1, fontSize: 15 },
  micBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: Brand.orange, alignItems: 'center', justifyContent: 'center' },
  stopBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#E5484D', alignItems: 'center', justifyContent: 'center' },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#E5484D' },
});
