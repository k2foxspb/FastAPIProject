import { LocaleConfig } from 'react-native-calendars';
import { MONTHS_RU, WEEKDAYS_SHORT_RU } from '../../journal/utils/dates';

// Русская локаль календаря (подключается один раз при импорте).
if (!LocaleConfig.locales.ru) {
  LocaleConfig.locales.ru = {
    monthNames: MONTHS_RU,
    monthNamesShort: ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
    dayNames: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
    dayNamesShort: ['Вс', ...WEEKDAYS_SHORT_RU.slice(0, 6)],
    today: 'Сегодня',
  };
  LocaleConfig.defaultLocale = 'ru';
}
