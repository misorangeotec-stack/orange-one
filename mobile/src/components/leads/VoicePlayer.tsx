/**
 * Plays back a recorded voice note (expo-audio) with a waveform, duration, a
 * CC/transcript toggle, and delete. The seed note has no audio file (uri empty)
 * — playback is disabled but the transcript still shows.
 */

import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Waveform } from '@/components/leads/Waveform';
import { Brand, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDuration } from '@/lib/leads/media';
import type { VoiceNote } from '@/lib/leads/types';

export function VoicePlayer({ note, onDelete }: { note: VoiceNote; onDelete?: () => void }) {
  const theme = useTheme();
  const hasAudio = !!note.uri;
  const player = useAudioPlayer(hasAudio ? note.uri : undefined);
  const status = useAudioPlayerStatus(player);
  const [showTranscript, setShowTranscript] = useState(false);

  const durationSec = (note.durationMs || 0) / 1000;
  const progress = durationSec > 0 ? Math.min(1, (status.currentTime || 0) / durationSec) : 0;

  const toggle = () => {
    if (!hasAudio) return;
    if (status.playing) {
      player.pause();
    } else {
      if (status.didJustFinish || progress >= 1) player.seekTo(0);
      player.play();
    }
  };

  return (
    <View style={[styles.wrap, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <View style={styles.row}>
        <Pressable onPress={toggle} disabled={!hasAudio} style={[styles.playBtn, !hasAudio && styles.dim]}>
          <Ionicons name={status.playing ? 'pause' : 'play'} size={18} color="#ffffff" />
        </Pressable>
        <Waveform active={hasAudio} progress={progress} />
        <ThemedText type="small" themeColor="textSecondary">
          {formatDuration(note.durationMs || 0)}
        </ThemedText>
        {note.status === 'pending' ? <Ionicons name="cloud-offline-outline" size={16} color={theme.textSecondary} /> : null}
        <Pressable onPress={() => setShowTranscript((s) => !s)} hitSlop={6} style={styles.ccBtn}>
          <ThemedText type="small" style={{ color: showTranscript ? Brand.orange : theme.textSecondary, fontWeight: '700' }}>
            CC
          </ThemedText>
        </Pressable>
        {onDelete ? (
          <Pressable onPress={onDelete} hitSlop={6}>
            <Ionicons name="trash-outline" size={18} color="#E5484D" />
          </Pressable>
        ) : null}
      </View>

      {showTranscript ? (
        <View style={[styles.transcript, { borderTopColor: theme.border }]}>
          {note.summary ? (
            <View style={styles.metaLine}>
              <Ionicons name="sparkles" size={13} color={Brand.orange} />
              <ThemedText type="small" style={{ flex: 1, color: theme.text }}>
                {note.summary}
              </ThemedText>
            </View>
          ) : null}
          {note.suggestedInterest ? (
            <ThemedText type="small" themeColor="textSecondary">
              Interest: <ThemedText type="smallBold" style={{ color: Brand.orange }}>{note.suggestedInterest}</ThemedText>
            </ThemedText>
          ) : null}
          {note.followUps && note.followUps.length ? (
            <ThemedText type="small" themeColor="textSecondary">
              Follow-ups: {note.followUps.join(' · ')}
            </ThemedText>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary" style={styles.transcriptText}>
            {note.transcript
              ? note.transcript
              : note.status === 'pending'
                ? 'Waiting for network to transcribe…'
                : note.status === 'failed'
                  ? 'Transcription unavailable for this note.'
                  : 'No speech detected.'}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: Spacing.two + 2, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  playBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Brand.orange, alignItems: 'center', justifyContent: 'center' },
  ccBtn: { paddingHorizontal: 4 },
  dim: { opacity: 0.4 },
  transcript: { marginTop: Spacing.two, paddingTop: Spacing.two, borderTopWidth: 1, gap: Spacing.one },
  metaLine: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.one },
  transcriptText: { marginTop: Spacing.one },
});
