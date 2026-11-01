import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useJournal } from '../../context/JournalContext';
import { Chip, Field, HeaderButton, Input, JournalGate, MOODS, PrimaryButton, useColors } from '../../components/journal/common';
import { DateField, TimeField } from '../../components/journal/DateTimeFields';
import AttachmentStrip from '../../components/journal/AttachmentStrip';
import { deleteDiaryEntry, getDiaryEntry, listDiaryTags, saveDiaryEntry } from '../../journal/db/repos/diary';
import { deleteAttachment, listAttachments } from '../../journal/db/repos/attachments';
import { newUuid } from '../../journal/utils/uuid';
import { nowTime } from '../../journal/utils/dates';

const parseTags = (text) => {
  const result = [];
  String(text || '').split(/[,\n]/).forEach((raw) => {
    const t = raw.trim().replace(/^#+/, '').trim().slice(0, 50);
    if (t && !result.some((x) => x.toLowerCase() === t.toLowerCase())) result.push(t);
  });
  return result.slice(0, 20);
};

const DiaryForm = ({ navigation, route }) => {
  const colors = useColors();
  const { today } = useJournal();
  const existingUuid = route.params?.uuid || null;
  // Для новой записи UUID создаётся сразу - к нему привязываются фото до сохранения
  const [uuid] = useState(() => existingUuid || newUuid());
  const savedRef = useRef(!!existingUuid);
  const [loaded, setLoaded] = useState(!existingUuid);
  const [date, setDate] = useState(route.params?.date || today);
  const [time, setTime] = useState(existingUuid ? null : nowTime());
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [mood, setMood] = useState(null);
  const [tagsText, setTagsText] = useState('');
  const [knownTags, setKnownTags] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listDiaryTags().then(setKnownTags).catch(() => undefined);
    if (!existingUuid) return;
    getDiaryEntry(existingUuid).then((e) => {
      if (!e) {
        navigation.goBack();
        return;
      }
      setDate(e.entry_date);
      setTime(e.entry_time);
      setTitle(e.title || '');
      setBody(e.body || '');
      setMood(e.mood);
      setTagsText((e.tags || []).join(', '));
      setLoaded(true);
    });
  }, [existingUuid, navigation]);

  // Новая запись закрыта без сохранения - убираем добавленные к ней фото
  useEffect(() => () => {
    if (savedRef.current) return;
    listAttachments(uuid).then((items) => items.forEach((a) => deleteAttachment(a.uuid))).catch(() => undefined);
  }, [uuid]);

  const save = async () => {
    if (!body.trim() && !title.trim()) {
      Alert.alert('Запись пустая', 'Добавьте заголовок или текст');
      return;
    }
    setSaving(true);
    try {
      await saveDiaryEntry({
        entry_date: date,
        entry_time: time,
        title: title.trim() || null,
        body: body.slice(0, 20000),
        body_format: 'plain',
        mood,
        tags: parseTags(tagsText),
      }, uuid);
      savedRef.current = true;
      navigation.goBack();
    } catch (e) {
      Alert.alert('Не удалось сохранить', e?.message || '');
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    Alert.alert('Удалить запись?', 'Фото записи тоже будут удалены', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          await deleteDiaryEntry(uuid);
          navigation.goBack();
        },
      },
    ]);
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      title: existingUuid ? 'Запись' : 'Новая запись',
      headerRight: () => (existingUuid ? <HeaderButton icon="trash-outline" color={colors.error} onPress={remove} /> : null),
    });
  });

  if (!loaded) return null;
  const currentTags = parseTags(tagsText);
  const suggestions = knownTags.filter((t) => !currentTags.some((c) => c.toLowerCase() === t.toLowerCase())).slice(0, 10);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={styles.row}>
          <View style={{ flex: 3 }}>
            <Field label="Дата"><DateField value={date} onChange={(d) => d && setDate(d)} /></Field>
          </View>
          <View style={{ flex: 2 }}>
            <Field label="Время"><TimeField value={time} onChange={setTime} placeholder="—" /></Field>
          </View>
        </View>
        <Field label="Настроение">
          <View style={styles.moods}>
            {MOODS.map((m) => (
              <TouchableOpacity key={m.value} onPress={() => setMood(mood === m.value ? null : m.value)} style={styles.mood}>
                <Icon name={m.icon} size={30} color={mood === m.value ? m.color : colors.textSecondary} />
              </TouchableOpacity>
            ))}
          </View>
        </Field>
        <Field label="Заголовок">
          <Input value={title} onChangeText={setTitle} placeholder="Необязательно" maxLength={200} />
        </Field>
        <Field label="Текст">
          <Input
            value={body}
            onChangeText={setBody}
            placeholder="Что сегодня произошло?"
            multiline
            maxLength={20000}
            autoFocus={!existingUuid}
            style={{ minHeight: 160, textAlignVertical: 'top' }}
          />
        </Field>
        <Field label="Теги (через запятую)">
          <Input value={tagsText} onChangeText={setTagsText} placeholder="работа, семья" autoCapitalize="none" />
          {suggestions.length > 0 && (
            <View style={[styles.wrap, { marginTop: 8 }]}>
              {suggestions.map((t) => (
                <Chip key={t} label={`#${t}`} onPress={() => setTagsText(currentTags.concat(t).join(', '))} />
              ))}
            </View>
          )}
        </Field>
        <Field label="Фото">
          <AttachmentStrip ownerType="diary_entry" ownerUuid={uuid} />
        </Field>
        <PrimaryButton title="Сохранить" onPress={save} loading={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default function DiaryEditScreen({ navigation, route }) {
  return (
    <JournalGate navigation={navigation}>
      <DiaryForm navigation={navigation} route={route} />
    </JournalGate>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  moods: { flexDirection: 'row', justifyContent: 'space-between' },
  mood: { padding: 4 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
