import React, { useEffect, useLayoutEffect, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useJournalQuery } from '../../context/JournalContext';
import { Chip, EmptyState, HeaderButton, Input, JournalGate, MOODS, useColors } from '../../components/journal/common';
import { listDiary, listDiaryTags } from '../../journal/db/repos/diary';
import { formatDateRu, formatTime } from '../../journal/utils/dates';

const PAGE = 30;

const DiaryItem = React.memo(({ item, colors, onPress }) => {
  const mood = MOODS.find((m) => m.value === item.mood);
  return (
    <TouchableOpacity style={[styles.item, { backgroundColor: 'transparent', borderColor: colors.border }]} onPress={() => onPress(item)}>
      <View style={styles.itemHeader}>
        <Text style={[styles.date, { color: colors.textSecondary }]}>
          {formatDateRu(item.entry_date, { withWeekday: true })}{item.entry_time ? `, ${formatTime(item.entry_time)}` : ''}
        </Text>
        {item.photo_count > 0 && <Icon name="image-outline" size={14} color={colors.textSecondary} style={{ marginRight: 6 }} />}
        {mood && <Icon name={mood.icon} size={18} color={mood.color} />}
      </View>
      {!!item.title && <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>}
      {!!item.body && <Text style={[styles.body, { color: colors.text }]} numberOfLines={3}>{item.body}</Text>}
      {!!item.tags?.length && (
        <Text style={[styles.tags, { color: colors.primary }]} numberOfLines={1}>{item.tags.map((t) => `#${t}`).join(' ')}</Text>
      )}
    </TouchableOpacity>
  );
});

const DiaryContent = ({ navigation }) => {
  const colors = useColors();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [tag, setTag] = useState(null);
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(query);
      setLimit(PAGE);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: entries } = useJournalQuery(() => listDiary({ query: debounced, tag, limit }), [debounced, tag, limit]);
  const { data: tags } = useJournalQuery(() => listDiaryTags(), []);
  const open = (item) => navigation.navigate('DiaryEdit', { uuid: item.uuid });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.search}>
        <Input value={query} onChangeText={setQuery} placeholder="Поиск по записям" returnKeyType="search" clearButtonMode="while-editing" />
      </View>
      {!!tags?.length && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagScroll} contentContainerStyle={styles.tagRow}>
          {tags.slice(0, 30).map((t) => (
            <Chip key={t} label={`#${t}`} selected={tag === t} onPress={() => { setTag(tag === t ? null : t); setLimit(PAGE); }} />
          ))}
        </ScrollView>
      )}
      <FlatList
        data={entries || []}
        keyExtractor={(item) => item.uuid}
        renderItem={({ item }) => <DiaryItem item={item} colors={colors} onPress={open} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (entries && entries.length >= limit) setLimit(limit + PAGE);
        }}
        initialNumToRender={10}
        windowSize={7}
        removeClippedSubviews
        contentContainerStyle={{ paddingBottom: 32, flexGrow: 1 }}
        ListEmptyComponent={entries ? (
          <EmptyState
            icon="book-outline"
            title={debounced || tag ? 'Ничего не найдено' : 'Дневник пуст'}
            subtitle={debounced || tag ? null : 'Запишите, как прошёл день'}
            actionLabel={debounced || tag ? null : 'Новая запись'}
            onAction={() => navigation.navigate('DiaryEdit', {})}
          />
        ) : null}
      />
    </View>
  );
};

export default function DiaryListScreen({ navigation }) {
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <HeaderButton icon="add" onPress={() => navigation.navigate('DiaryEdit', {})} />,
    });
  }, [navigation]);
  return (
    <JournalGate navigation={navigation}>
      <DiaryContent navigation={navigation} />
    </JournalGate>
  );
}

const styles = StyleSheet.create({
  search: { paddingHorizontal: 12, paddingTop: 12 },
  tagScroll: { flexGrow: 0 },
  tagRow: { paddingHorizontal: 12, paddingTop: 10 },
  item: { marginHorizontal: 12, marginTop: 10, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 12 },
  itemHeader: { flexDirection: 'row', alignItems: 'center' },
  date: { flex: 1, fontSize: 13 },
  title: { fontSize: 16, fontWeight: '600', marginTop: 6 },
  body: { fontSize: 15, marginTop: 4, lineHeight: 20 },
  tags: { fontSize: 13, marginTop: 6 },
});
