import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { AppProvider } from '@/contexts/AppContext';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { useFonts, Cormorant_400Regular, Cormorant_500Medium, Cormorant_600SemiBold } from '@expo-google-fonts/cormorant';

function RootLayoutContent() {
  const { colors, isDark } = useTheme();

  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="project/[id]"
          options={{
            headerShown: true,
            headerBackTitle: 'Back',
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.text,
            headerTitleStyle: { color: colors.text },
          }}
        />
        <Stack.Screen name="+not-found" />
      </Stack>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </>
  );
}

export default function RootLayout() {
  useFrameworkReady();
  useFonts({ Cormorant_400Regular, Cormorant_500Medium, Cormorant_600SemiBold })

  return (
    <AppProvider>
      <ThemeProvider>
        <RootLayoutContent />
      </ThemeProvider>
    </AppProvider>
  );
}
