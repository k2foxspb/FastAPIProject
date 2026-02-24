import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { getShadow } from '../utils/shadowStyles';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { usersApi } from '../api';

import { useNotifications } from '../context/NotificationContext';

export default function AdminScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { currentUser, loadingUser } = useNotifications();
  const [role, setRole] = useState(currentUser?.role);

  useEffect(() => {
    if (loadingUser) return;
    
    if (currentUser) {
      setRole(currentUser.role);
    } else {
      setRole(null);
    }
  }, [currentUser, loadingUser]);

  const adminMenu = [
    { title: 'Пользователи и Роли', icon: 'people-outline', screen: 'AdminUsers', ownerOnly: true },
    { title: 'Модерация', icon: 'shield-outline', screen: 'AdminModeration' },
    { title: 'Новости', icon: 'newspaper-outline', screen: 'AdminNews' },
    { title: 'Категории', icon: 'list-outline', screen: 'AdminCategories' },
    { title: 'Товары', icon: 'cart-outline', screen: 'AdminProducts' },
    { title: 'Заказы', icon: 'receipt-outline', screen: 'AdminOrders' },
    { title: 'Отзывы', icon: 'star-outline', screen: 'AdminReviews' },
    { title: 'Чаты пользователей', icon: 'chatbubbles-outline', screen: 'AdminChats', ownerOnly: true },
    { title: 'Загрузить новую версию приложения', icon: 'cloud-upload-outline', screen: 'AdminAppUpload', ownerOnly: true },
  ];

  const filteredMenu = adminMenu.filter(item => !item.ownerOnly || role === 'owner');

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Админ-панель</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Управление магазином</Text>
      </View>

      <View style={styles.menu}>
        {filteredMenu.map((item, index) => (
          <TouchableOpacity
            key={index}
            style={[styles.menuItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => navigation.navigate(item.screen)}
          >
            <View style={styles.menuItemLeft}>
              <Icon name={item.icon} size={24} color={colors.primary} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>{item.title}</Text>
            </View>
            <Icon name="chevron-forward" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 20, marginTop: 10 },
  title: { fontSize: 28, fontWeight: 'bold' },
  subtitle: { fontSize: 16, marginTop: 5 },
  menu: { padding: 15 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 18,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    ...getShadow('#000', { width: 0, height: 1 }, 0.1, 2, 2),
  },
  menuItemLeft: { flexDirection: 'row', alignItems: 'center' },
  menuItemText: { fontSize: 16, fontWeight: '600', marginLeft: 15 },
});
