import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Text, TouchableOpacity, View } from 'react-native';
import { JournalGate, PrimaryButton, Section, useColors } from '../../components/journal/common';
import { usersApi, chatApi } from '../../api';
import { storage } from '../../utils/storage';
import { generateClientId } from '../chat/utils';
import { useJournal } from '../../context/JournalContext';
import { buildPeriodAnalytics } from '../../journal/db/repos/analytics';
import { SHARE_SECTIONS, SHARE_DAY_SECTIONS, buildDaySummaryText, buildPeriodText } from '../../journal/share/summaryText';
import { addDays, monthBounds, todayKey } from '../../journal/utils/dates';

const PERIOD_OPTIONS = [
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
];

const Content = ({ navigation, route }) => {
  const colors = useColors();
  const { timezone } = useJournal();
  const [text, setText] = useState(route.params?.text || '');
  const [period, setPeriod] = useState(route.params?.period || null);
  const [analytics, setAnalytics] = useState(null);
  const dayParams = route.params?.kind === 'day' ? route.params : null;
  const [daySections, setDaySections] = useState(SHARE_DAY_SECTIONS.map((s) => s.key));
  const [sections, setSections] = useState(SHARE_SECTIONS.map((s) => s.key));
  const [building, setBuilding] = useState(false);
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState(null);

  const choosePeriod = async (key) => {
    setPeriod(key);
    setBuilding(true);
    try {
      const today = todayKey(timezone);
      let start;
      let end;
      if (key === 'month') {
        const [y, m] = today.split('-').map(Number);
        [start, end] = monthBounds(y, m);
      } else {
        start = addDays(today, -6);
        end = today;
      }
      const data = await buildPeriodAnalytics(start, end);
      setAnalytics(data);
      setText(buildPeriodText(data, key, sections));
    } catch (e) {
      Alert.alert('Ошибка', e?.message || 'Не удалось собрать сводку');
    } finally {
      setBuilding(false);
    }
  };

  const toggleSection = (key) => {
    const next = sections.includes(key) ? sections.filter((k) => k !== key) : [...sections, key];
    setSections(next);
    if (analytics && period) setText(buildPeriodText(analytics, period, next));
  };

  const toggleDaySection = (key) => {
    const next = daySections.includes(key) ? daySections.filter((k) => k !== key) : [...daySections, key];
    setDaySections(next);
    setText(buildDaySummaryText(dayParams.data || {}, dayParams.date, next));
  };

  useEffect(() => {
    if (dayParams) setText(buildDaySummaryText(dayParams.data || {}, dayParams.date, daySections));
  }, []);

  useEffect(() => {
    usersApi.getFriendsList()
      .then((res) => setFriends(Array.isArray(res.data) ? res.data : (res.data?.items || [])))
      .catch((e) => Alert.alert('Ошибка', e?.message || 'Не удалось загрузить друзей'))
      .finally(() => setLoading(false));
  }, []);

  const sendTo = async (friend) => {
    setSendingId(friend.id);
    try {
      const token = await storage.getAccessToken();
      await chatApi.sendMessage({
        receiver_id: friend.id,
        message: text,
        message_type: 'text',
        client_id: generateClientId(),
      }, token);
      Alert.alert('Отправлено', 'Сообщение отправлено в личные сообщения', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('Ошибка', e?.message || 'Не удалось отправить сообщение');
    } finally {
      setSendingId(null);
    }
  };

  const renderFriend = ({ item }) => {
    const name = `${item.first_name || ''} ${item.last_name || ''}`.trim() || item.email || `Пользователь ${item.id}`;
    return (
      <TouchableOpacity
        onPress={() => sendTo(item)}
        disabled={sendingId !== null}
        style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 }}
      >
        <Text style={{ color: colors.text, flex: 1, fontSize: 16 }}>{name}</Text>
        {sendingId === item.id
          ? <ActivityIndicator color={colors.primary} />
          : <Text style={{ color: colors.primary, fontWeight: '600' }}>Отправить</Text>}
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Section title="Сводка">
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
          {PERIOD_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.key}
              onPress={() => choosePeriod(opt.key)}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 14,
                borderRadius: 16,
                backgroundColor: period === opt.key ? colors.primary : colors.surface,
              }}
            >
              <Text style={{ color: period === opt.key ? '#fff' : colors.text, fontWeight: '600' }}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {(!!analytics || !!dayParams) && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
            {(dayParams ? SHARE_DAY_SECTIONS : SHARE_SECTIONS).map((s) => {
              const on = (dayParams ? daySections : sections).includes(s.key);
              return (
                <TouchableOpacity
                  key={s.key}
                  onPress={() => (dayParams ? toggleDaySection(s.key) : toggleSection(s.key))}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 14,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: colors.primary,
                    backgroundColor: on ? colors.primary : 'transparent',
                  }}
                >
                  <Text style={{ color: on ? '#fff' : colors.primary, fontWeight: '600' }}>{s.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
        {building
          ? <ActivityIndicator style={{ margin: 16 }} color={colors.primary} />
          : <Text style={{ color: colors.textSecondary, paddingHorizontal: 16, paddingVertical: 8 }}>{text || 'Выберите период'}</Text>}
      </Section>
      {!!text && !building && (
        <PrimaryButton
          title="Опубликовать на странице"
          onPress={() => navigation.navigate('CreatePost', { initialText: text })}
          style={{ marginHorizontal: 12, marginTop: 8 }}
        />
      )}
      <Section title="Отправить другу">
        {loading && <ActivityIndicator style={{ margin: 16 }} color={colors.primary} />}
        {!loading && friends.length === 0 && (
          <Text style={{ color: colors.textSecondary, paddingHorizontal: 16, paddingVertical: 12 }}>
            Пока нет друзей. Добавьте их в разделе «Пользователи».
          </Text>
        )}
        <FlatList data={friends} keyExtractor={(item) => String(item.id)} renderItem={renderFriend} />
      </Section>
    </View>
  );
};

export default function ShareSummaryScreen({ navigation, route }) {
  return (
    <JournalGate navigation={navigation}>
      <Content navigation={navigation} route={route} />
    </JournalGate>
  );
}
