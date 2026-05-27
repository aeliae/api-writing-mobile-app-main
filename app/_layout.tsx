import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { AppProvider } from '@/contexts/AppContext';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';

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

  return (
    <AppProvider>
      <ThemeProvider>
        <RootLayoutContent />
      </ThemeProvider>
    </AppProvider>
  );
}
