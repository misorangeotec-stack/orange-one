import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthGate } from '@/components/auth-gate';
import { AuthProvider } from '@/hooks/use-auth';
import { LeadsProvider } from '@/lib/leads/store';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <AuthProvider>
            <AuthGate>
              <LeadsProvider>
                <Stack>
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  <Stack.Screen name="add" options={{ presentation: 'transparentModal', headerShown: false, animation: 'fade' }} />
                  <Stack.Screen name="drafts" options={{ headerShown: false }} />
                  <Stack.Screen name="capture/camera" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
                  <Stack.Screen name="contact/new" options={{ headerShown: false, presentation: 'modal' }} />
                  <Stack.Screen name="contact/review" options={{ headerShown: false }} />
                  <Stack.Screen name="contact/[id]" options={{ headerShown: false }} />
                  <Stack.Screen name="contact/duplicate" options={{ headerShown: false }} />
                </Stack>
              </LeadsProvider>
            </AuthGate>
          </AuthProvider>
          <StatusBar style="auto" />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
