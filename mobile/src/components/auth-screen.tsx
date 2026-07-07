/**
 * Full-screen sign in. Rendered by AuthGate when there's no session (login is
 * required). Sign-in only — Orange One accounts are provisioned by an admin in
 * the web portal (a user's mobile number is their initial password).
 */

import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';

export function AuthScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { signInWithPassword } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    const { error } = await signInWithPassword(email, password);
    setBusy(false);
    if (error) setError(error);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.six, paddingBottom: insets.bottom + Spacing.four },
        ]}
        keyboardShouldPersistTaps="handled">
        <View style={styles.inner}>
          <Image
            source={require('@/assets/images/icon.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <ThemedText type="subtitle" style={styles.title}>
            Orange One
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.subtitle}>
            Sign in with your Orange One account.
          </ThemedText>

          <View style={styles.form}>
            <TextInput
              style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
              placeholder="Email"
              placeholderTextColor={theme.textSecondary}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              editable={!busy}
            />
            <TextInput
              style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
              placeholder="Password"
              placeholderTextColor={theme.textSecondary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              textContentType="password"
              editable={!busy}
              onSubmitEditing={submit}
              returnKeyType="go"
            />

            {error && (
              <ThemedText type="small" style={[styles.error, { color: '#E5484D' }]}>
                {error}
              </ThemedText>
            )}

            <Pressable
              onPress={submit}
              disabled={busy}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: Brand.orange },
                (pressed || busy) && styles.dim,
              ]}>
              {busy ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <ThemedText style={styles.buttonText}>Sign in</ThemedText>
              )}
            </Pressable>

            <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
              First time? Your initial password is your registered mobile number.
            </ThemedText>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  inner: {
    width: '100%',
    maxWidth: Math.min(MaxContentWidth, 420),
    alignItems: 'center',
    gap: Spacing.two,
  },
  logo: { width: 72, height: 72, borderRadius: 16, marginBottom: Spacing.one },
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center', fontSize: 16, lineHeight: 24, marginBottom: Spacing.three },
  form: { width: '100%', gap: Spacing.two },
  input: {
    width: '100%',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    fontSize: 16,
  },
  error: { paddingHorizontal: Spacing.one },
  button: {
    width: '100%',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  buttonText: { color: '#ffffff', fontWeight: '700', fontSize: 16 },
  hint: { textAlign: 'center', marginTop: Spacing.one, paddingHorizontal: Spacing.one },
  dim: { opacity: 0.6 },
});
