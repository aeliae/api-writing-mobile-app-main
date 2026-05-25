import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { useApp } from './AppContext';

type ThemeMode = 'light' | 'dark' | 'system';

type ColorScheme = Omit<typeof lightColors, 'statusBar'> & { statusBar: 'dark' | 'light' };

interface Theme {
  mode: ThemeMode;
  isDark: boolean;
  colors: ColorScheme;
  toggleTheme: () => void;
  setThemeMode: (mode: ThemeMode) => void;
}

const lightColors = {
  background: '#FFFFFF',
  surface: '#F8F9FA',
  surfaceSecondary: '#F0F1F3',
  text: '#1A1A1A',
  textSecondary: '#6B7280',
  textTertiary: '#9CA3AF',
  border: '#E5E7EB',
  borderLight: '#F3F4F6',
  primary: '#2563EB',
  primaryLight: '#DBEAFE',
  success: '#10B981',
  successLight: '#D1FAE5',
  warning: '#F59E0B',
  warningLight: '#FEF3C7',
  error: '#EF4444',
  errorLight: '#FEE2E2',
  card: '#FFFFFF',
  cardShadow: 'rgba(0, 0, 0, 0.05)',
  overlay: 'rgba(0, 0, 0, 0.5)',
  bubbleUser: '#2563EB',
  bubbleUserText: '#FFFFFF',
  bubbleAssistant: '#F3F4F6',
  bubbleAssistantText: '#1F2937',
  tabBar: '#FFFFFF',
  tabBarBorder: '#E5E7EB',
  tabBarActive: '#2563EB',
  tabBarInactive: '#9CA3AF',
  input: '#FFFFFF',
  inputBorder: '#E5E7EB',
  placeholder: '#9CA3AF',
  statusBar: 'dark' as const,
};

const darkColors = {
  ...lightColors,
  background: '#0F172A',
  surface: '#1E293B',
  surfaceSecondary: '#334155',
  text: '#F1F5F9',
  textSecondary: '#94A3B8',
  textTertiary: '#64748B',
  border: '#334155',
  borderLight: '#1E293B',
  primary: '#3B82F6',
  primaryLight: '#1E3A5F',
  success: '#34D399',
  successLight: '#064E3B',
  warning: '#FBBF24',
  warningLight: '#78350F',
  error: '#F87171',
  errorLight: '#7F1D1D',
  card: '#1E293B',
  cardShadow: 'rgba(0, 0, 0, 0.3)',
  overlay: 'rgba(0, 0, 0, 0.7)',
  bubbleUser: '#3B82F6',
  bubbleUserText: '#FFFFFF',
  bubbleAssistant: '#334155',
  bubbleAssistantText: '#F1F5F9',
  tabBar: '#0F172A',
  tabBarBorder: '#334155',
  tabBarActive: '#3B82F6',
  tabBarInactive: '#64748B',
  input: '#1E293B',
  inputBorder: '#334155',
  placeholder: '#64748B',
  statusBar: 'light' as const,
};

const ThemeContext = createContext<Theme | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemColorScheme = useColorScheme();
  const { settings, updateSettings } = useApp();

  const getEffectiveTheme = (mode: ThemeMode, systemScheme: 'light' | 'dark' | null | undefined): boolean => {
    if (mode === 'system') {
      return systemScheme === 'dark';
    }
    return mode === 'dark';
  };

  const [isDark, setIsDark] = useState(() => getEffectiveTheme(settings.theme, systemColorScheme));

  useEffect(() => {
    setIsDark(getEffectiveTheme(settings.theme, systemColorScheme));
  }, [settings.theme, systemColorScheme]);

  const toggleTheme = () => {
    const newMode = isDark ? 'light' : 'dark';
    updateSettings({ theme: newMode });
  };

  const setThemeMode = (mode: ThemeMode) => {
    updateSettings({ theme: mode });
  };

  const colors = isDark ? darkColors : lightColors;

  const value: Theme = {
    mode: settings.theme,
    isDark,
    colors,
    toggleTheme,
    setThemeMode,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
