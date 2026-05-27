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

  secondary: '#D4940A',
  secondaryLight: '#FDF4DC',
  proseUserBg: '#F8F6F2',
  proseUserText: '#1A1A1A',
  proseUserAccent: '#2563EB',
  proseAiText: '#1A1A1A',
  proseAiAccent: '#D4940A',
};

const darkColors = {
  ...lightColors,
   background: '#151110',
   surface: '#1E1915',
   surfaceSecondary: '#2C241E',
   text: '#F2EDE5',
   textSecondary: '#A89B8A',
   textTertiary: '#6E6255',
   border: '#342B24',
   borderLight: '#1E1915',
   primary: '#5B9AFF',
   primaryLight: '#1F2A3A',
   success: '#34D399',
   successLight: '#0D2E1F',
   warning: '#FBBF24',
   warningLight: '#2A2010',
   error: '#F87171',
   errorLight: '#2D1515',
   card: '#1E1915',
   cardShadow: 'rgba(0, 0, 0, 0.4)',
   overlay: 'rgba(0, 0, 0, 0.7)',
   bubbleUser: '#5B9AFF',       // kept for fallback — see chat redesign below
   bubbleUserText: '#F2EDE5',
   bubbleAssistant: 'transparent',
   bubbleAssistantText: '#E8DFD2',
   tabBar: '#151110',
   tabBarBorder: '#342B24',
   tabBarActive: '#F5B642',     // amber owl-eye accent
   tabBarInactive: '#6E6255',
   input: '#1E1915',
   inputBorder: '#342B24',
   placeholder: '#6E6255',
   statusBar: 'light' as const,
 
   // New — literary prose pane tokens
   secondary: '#F5B642',
   secondaryLight: '#2A2010',
   proseUserBg: '#241E18',
   proseUserText: '#F2EDE5',
   proseUserAccent: '#5B9AFF',
   proseAiText: '#E8DFD2',
   proseAiAccent: '#F5B642',
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
