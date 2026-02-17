import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import api from '../api';
import { getFullUrl } from '../utils/urlHelper';
import { formatName } from '../utils/formatters';

export default function AdminChatsScreen({ navigation }) {
  const [dialogs, setDialogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  const fetchAllDialogs = async () => {
    try {
      setLoading(true);
      const response = await api.get('/admin/chats');
      setDialogs(response.data);
    } catch (error) {
      console.error('Failed to fetch admin dialogs:', error);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchAllDialogs();
    }, [])
  );

  const renderItem = ({ item }) => {
    const { user1, user2, last_message, last_message_time } = item;
    
    return (
      <TouchableOpacity 
        style={[styles.dialogItem, { borderBottomColor: colors.border, backgroundColor: colors.surface }]}
        onPress={() => navigation.navigate('AdminChatDetail', { 
          u1: user1, 
          u2: user2 
        })}
      >
        <View style={styles.avatarsContainer}>
          <Image 
            source={{ uri: getFullUrl(user1.avatar_url) || 'https://via.placeholder.com/150' }} 
            style={styles.avatar} 
          />
          <Image 
            source={{ uri: getFullUrl(user2.avatar_url) || 'https://via.placeholder.com/150' }} 
            style={[styles.avatar, styles.secondAvatar]} 
          />
        </View>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={[styles.names, { color: colors.text }]} numberOfLines={1}>
              {formatName(user1)} ↔ {formatName(user2)}
            </Text>
            <Text style={[styles.time, { color: colors.textSecondary }]}>
              {new Date(last_message_time).toLocaleDateString()}
            </Text>
          </View>
          <Text style={[styles.lastMessage, { color: colors.textSecondary }]} numberOfLines={1}>
            {last_message}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={dialogs}
        keyExtractor={(item, index) => index.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={{ color: colors.text }}>Диалогов не найдено</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingVertical: 10 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  dialogItem: { 
    flexDirection: 'row', 
    padding: 15, 
    borderBottomWidth: 1, 
    alignItems: 'center' 
  },
  avatarsContainer: {
    width: 60,
    height: 50,
    marginRight: 15,
    position: 'relative'
  },
  avatar: { 
    width: 40, 
    height: 40, 
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#fff',
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 1
  },
  secondAvatar: {
    top: 10,
    left: 20,
    zIndex: 0
  },
  content: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  names: { fontWeight: 'bold', fontSize: 14, flex: 1, marginRight: 10 },
  time: { fontSize: 10 },
  lastMessage: { fontSize: 13 },
});
