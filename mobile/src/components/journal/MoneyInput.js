import React, { useEffect, useState } from 'react';
import { TextInput } from 'react-native';
import { useColors } from './common';
import { kopToInput, parseMoneyToKop } from '../../journal/utils/money';

export default function MoneyInput({ value, onChangeKop, style, placeholder = '0,00' }) {
  const colors = useColors();
  const [text, setText] = useState(kopToInput(value));

  useEffect(() => setText(kopToInput(value)), [value]);

  return (
    <TextInput
      keyboardType="decimal-pad"
      value={text}
      placeholder={placeholder}
      placeholderTextColor={colors.textSecondary}
      onChangeText={(next) => {
        setText(next);
        const parsed = parseMoneyToKop(next);
        if (parsed !== null) onChangeKop?.(parsed);
        else if (!next.trim()) onChangeKop?.(null);
      }}
      onBlur={() => {
        const parsed = parseMoneyToKop(text);
        if (parsed !== null) setText(kopToInput(parsed));
      }}
      style={[{ color: colors.text, borderColor: colors.border, backgroundColor: colors.surface, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 18 }, style]}
    />
  );
}
