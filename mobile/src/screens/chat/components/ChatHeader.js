import React from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, ActivityIndicator, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { formatStatus, formatName, getAvatarUrl } from '../../../utils/formatters';
import { styles } from '../styles';

// Шапка чата: режим выделения / строка поиска / информация о собеседнике
export default function ChatHeader({
  colors,
  insets,
  navigation,
  userId,
  userName,
  interlocutor,
  isPartnerTyping,
  // выделение
  selectionMode,
  selectedIds,
  onClearSelection,
  onBulkDelete,
  onForward,
  // поиск
  isSearching,
  searchQuery,
  onSearchChange,
  isLoadingSearchResults,
  globalSearchResults,
  currentGlobalSearchIdx,
  onPrevResult,
  onNextResult,
  onToggleSearch,
}) {
  return (
    <View style={[styles.header, { 
      borderBottomColor: colors.border, 
      backgroundColor: colors.background, 
      paddingTop: insets.top || (Platform.OS === 'ios' ? 40 : 10) 
    }]}>
      {selectionMode ? (
        <View style={styles.selectionHeader}>
          <TouchableOpacity onPress={onClearSelection}>
            <MaterialIcons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.selectionTitle, { color: colors.text }]}>Выбрано: {selectedIds.length}</Text>
          <View style={{ flexDirection: 'row' }}>
            <TouchableOpacity onPress={onForward} disabled={selectedIds.length === 0} style={{ marginRight: 16 }}>
              <MaterialIcons name="forward" size={24} color={selectedIds.length > 0 ? colors.primary : colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={onBulkDelete} disabled={selectedIds.length === 0}>
              <MaterialIcons name="delete" size={24} color={selectedIds.length > 0 ? colors.error : colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      ) : isSearching ? (
        <View style={styles.searchBar}>
          <TextInput
            autoFocus
            style={[styles.searchInput, { color: colors.text, backgroundColor: colors.border + '44' }]}
            placeholder="Поиск..."
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={onSearchChange}
          />
          {isLoadingSearchResults && (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 8 }} />
          )}
          {searchQuery.length > 0 && globalSearchResults.length === 0 && !isLoadingSearchResults && (
             <Text style={[styles.noResultsText, { color: colors.error }]}>Нет</Text>
          )}
          <View style={styles.searchControls}>
            <View style={styles.searchNav}>
              {globalSearchResults.length > 0 && (
                <Text style={[styles.searchCount, { color: colors.textSecondary }]}>
                  {currentGlobalSearchIdx + 1}/{globalSearchResults.length}
                </Text>
              )}
              <TouchableOpacity 
                onPress={onPrevResult} 
                style={[styles.searchNavItem, { opacity: globalSearchResults.length > 0 ? 1 : 0.3 }]}
                disabled={globalSearchResults.length === 0}
              >
                <MaterialIcons name="keyboard-arrow-up" size={28} color={colors.text} />
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={onNextResult} 
                style={[styles.searchNavItem, { opacity: globalSearchResults.length > 0 ? 1 : 0.3 }]}
                disabled={globalSearchResults.length === 0}
              >
                <MaterialIcons name="keyboard-arrow-down" size={28} color={colors.text} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={onToggleSearch} style={styles.searchClose}>
              <MaterialIcons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.headerInfoContainer}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <MaterialIcons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.headerInfo} 
            onPress={() => navigation.navigate('UserProfile', { userId: userId })}
          >
            <View style={styles.headerAvatarContainer}>
              <Image 
                source={{ uri: getAvatarUrl(interlocutor?.avatar_preview_url || interlocutor?.avatar_url) }} 
                style={styles.headerAvatar} 
              />
              {interlocutor?.status === 'online' && (
                <View style={[styles.headerOnlineBadge, { backgroundColor: '#4CAF50', borderColor: colors.background }]} />
              )}
            </View>
            <View>
              <Text style={[styles.headerTitle, { color: colors.text }]}>{formatName(interlocutor) || userName}</Text>
              {isPartnerTyping ? (
                <Text style={[styles.headerStatus, { color: colors.primary, fontWeight: 'bold' }]}>печатает...</Text>
              ) : interlocutor && (
                <Text style={[styles.headerStatus, { color: colors.textSecondary }]}>
                  {formatStatus(interlocutor.status, interlocutor.last_seen)}
                </Text>
              )}
            </View>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.headerIconButton} 
            onPress={onToggleSearch}
          >
            <MaterialIcons name="search" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
