import React, { createContext, useState, useContext, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { storage } from '../utils/storage';

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const systemColorScheme = useColorScheme();
  const [theme, setTheme] = useState(systemColorScheme || 'light');
  const [isSystemTheme, setIsSystemTheme] = useState(true);

  useEffect(() => {
    const loadTheme = async () => {
      const savedTheme = await storage.getItem('user-theme');
      const savedIsSystem = await storage.getItem('use-system-theme');
      
      if (savedIsSystem === 'false') {
        setIsSystemTheme(false);
        if (savedTheme) {
          setTheme(savedTheme);
        }
      } else {
        setIsSystemTheme(true);
        setTheme(systemColorScheme || 'light');
      }
    };
    loadTheme();
  }, []);

  useEffect(() => {
    if (isSystemTheme) {
      setTheme(systemColorScheme || 'light');
    }
  }, [systemColorScheme, isSystemTheme]);

  const toggleTheme = async (newTheme) => {
    setTheme(newTheme);
    setIsSystemTheme(false);
    await storage.saveItem('user-theme', newTheme);
    await storage.saveItem('use-system-theme', 'false');
  };

  const useSystemThemeSetting = async () => {
    setIsSystemTheme(true);
    setTheme(systemColorScheme || 'light');
    await storage.saveItem('use-system-theme', 'true');
  };

  return (
    <ThemeContext.Provider value={{ 
      theme, 
      isDark: theme === 'dark', 
      toggleTheme, 
      isSystemTheme, 
      useSystemThemeSetting 
    }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
