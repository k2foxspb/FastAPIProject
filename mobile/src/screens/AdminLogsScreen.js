import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { adminApi } from '../api';
import { Ionicons as Icon, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { logger } from '../utils/logger';

export default function AdminLogsScreen() {
  const [logs, setLogs] = useState([]);
  const [filteredLogs, setFilteredLogs] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [logType, setLogType] = useState('server'); // 'server' or 'app'
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = logType === 'server' 
        ? await adminApi.getLogs(1000)
        : await adminApi.getAppLogs(1000);
        
      // Логи приходят в виде массива строк
      const logLines = res.data.logs || [];
      // Инвертируем порядок, чтобы последние были сверху
      const reversedLogs = [...logLines].reverse();
      setLogs(reversedLogs);
      filterLogs(search, reversedLogs);
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const filterLogs = (text, allLogs = logs) => {
    setSearch(text);
    if (!text) {
      setFilteredLogs(allLogs);
      return;
    }
    const filtered = allLogs.filter(line => 
      line.toLowerCase().includes(text.toLowerCase())
    );
    setFilteredLogs(filtered);
  };

  useEffect(() => {
    fetchLogs();
    if (logType === 'app') {
      logger.info('Пользователь открыл логи приложения в админ-панели');
    }
  }, [logType]);

  const renderLogItem = ({ item }) => (
    <View style={[styles.logItem, { borderBottomColor: colors.border }]}>
      <Text style={[styles.logText, { color: colors.text }]}>{item}</Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.tabContainer, { borderBottomColor: colors.border }]}>
        <TouchableOpacity 
          style={[styles.tab, logType === 'server' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
          onPress={() => setLogType('server')}
        >
          <Text style={[styles.tabText, { color: logType === 'server' ? colors.primary : colors.textSecondary }]}>Сервер</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tab, logType === 'app' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
          onPress={() => setLogType('app')}
        >
          <Text style={[styles.tabText, { color: logType === 'app' ? colors.primary : colors.textSecondary }]}>Приложение</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.searchContainer, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <Icon name="search" size={20} color={colors.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Поиск по логам..."
          placeholderTextColor={colors.textSecondary}
          value={search}
          onChangeText={filterLogs}
        />
        {search !== '' && (
          <TouchableOpacity onPress={() => filterLogs('')}>
            <Icon name="close-circle" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredLogs}
          keyExtractor={(item, index) => index.toString()}
          renderItem={renderLogItem}
          ListEmptyComponent={
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Логи не найдены</Text>
          }
          refreshing={loading}
          onRefresh={fetchLogs}
          initialNumToRender={50}
          maxToRenderPerBatch={100}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  tabContainer: {
    flexDirection: 'row',
    height: 50,
    borderBottomWidth: 1,
  },
  tab: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  searchIcon: { marginRight: 10 },
  searchInput: { flex: 1, fontSize: 16, height: 40 },
  logItem: { padding: 8, borderBottomWidth: 0.5 },
  logText: { 
    fontSize: 11, 
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' 
  },
  emptyText: { textAlign: 'center', marginTop: 20, fontSize: 16 },
});
