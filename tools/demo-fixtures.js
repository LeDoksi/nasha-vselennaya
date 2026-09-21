'use strict';
// Данные для визуального стенда (tools/demo.html). Никаких настоящих фото и
// текстов — стенд нужен, чтобы смотреть на вёрстку, а не на нашу переписку.
// Формат объектов повторяет то, что кладёт в db репозиторий (src/04-repo.js,
// loadHotSet): события/свидания/заметки/списки/хотелки/фото/лейблы — те же
// поля, что и в настоящих документах Firestore.

function demoPhotoDataUrl(i) {
  const hues = [265, 275, 285, 30, 45, 200];
  const h = hues[i % hues.length];
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="' + (i % 3 === 0 ? 800 : 450) + '">' +
    '<rect width="100%" height="100%" fill="hsl(' + h + ' 40% ' + (28 + (i % 4) * 9) + '%)"/></svg>';
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

// «Ближайшие события» и «наши свидания» на Главной завязаны на настоящее
// today — если зашить конкретную дату, через неделю стенд тихо перестал бы
// показывать непустой список. Часть фикстур поэтому считается от момента
// открытия страницы, а не хранится константой.
function demoOffsetDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Те же служебные строки-лейблы, что EVENT_LABEL/DATE_LABEL в src/00-core.js —
// не импортируем константу (app.js грузится позже и в том же глобальном
// пространстве скриптов, повторное объявление const с тем же именем упало бы
// SyntaxError), поэтому значения продублированы буквально.
const DEMO_EVENT_LABEL = '📅 События';
const DEMO_DATE_LABEL = '💞 Свидания';

const demoFixtures = {
  // 7 событий (минимум 6), пять разных лет — включая одно многодневное (ev-trip).
  events: [
    { id: 'ev-birthday-gosha', title: 'День рождения Гоши', date: '2019-11-02', emoji: '🎂', repeat: true },
    { id: 'ev-start', title: 'Мы начали встречаться', date: '2023-03-30', emoji: '💜', repeat: true },
    { id: 'ev-first-date', title: 'Первое свидание', date: '2023-05-14', emoji: '🌸', repeat: true },
    { id: 'ev-flat', title: 'Переехали в свою квартиру', date: '2024-02-10', emoji: '🏡', repeat: false },
    { id: 'ev-trip', title: 'Отпуск на море', date: '2024-07-28', endDate: '2024-08-03', emoji: '🏖️', repeat: false },
    { id: 'ev-proposal', title: 'Предложение', date: '2025-06-06', emoji: '💍', repeat: true },
    { id: 'ev-soon', title: 'Вечеринка у друзей', date: demoOffsetDate(2), emoji: '🎉', repeat: false }
  ],
  // 2 свидания: dt-invite ждёт ответа от Гоши (from: dasha, responses.gosha пуст).
  dates: [
    {
      id: 'dt-invite',
      date: demoOffsetDate(4),
      time: '19:00',
      from: 'dasha',
      responses: { gosha: null, dasha: 'yes' },
      place: 'Кино',
      note: 'Новый фильм, который ты хотел посмотреть',
      emoji: '🎬',
      done: false
    },
    {
      id: 'dt-confirmed',
      date: demoOffsetDate(9),
      time: '20:00',
      from: 'gosha',
      responses: { gosha: 'yes', dasha: 'yes' },
      place: 'Ужин при свечах',
      note: 'Годовщина',
      emoji: '🕯️',
      done: false
    }
  ],
  notes: [
    { id: 'note-1', text: 'Ты — моё любимое утро 💜', ts: Date.now() - 1 * 86400000, pinned: true, author: 'gosha', order: 0 },
    { id: 'note-2', text: 'Не забудь полить цветы, пока я в командировке', ts: Date.now() - 2 * 86400000, pinned: false, author: 'dasha', order: 1 },
    { id: 'note-3', text: 'Список фильмов на выходные: пересмотреть «Начало»', ts: Date.now() - 3 * 86400000, pinned: false, author: 'gosha', order: 2 },
    { id: 'note-4', text: 'Спасибо за завтрак сегодня утром ✨', ts: Date.now() - 4 * 86400000, pinned: false, author: 'dasha', order: 3 },
    { id: 'note-5', text: 'Идея на день рождения: книга + плед', ts: Date.now() - 5 * 86400000, pinned: false, author: 'gosha', order: 4 }
  ],
  lists: [
    {
      id: 'list-shopping',
      name: '🛒 Покупки на неделю',
      order: 0,
      items: [
        { id: 'li-1', text: 'Молоко и хлеб', done: false },
        { id: 'li-2', text: 'Кофе в зёрнах', done: false },
        { id: 'li-3', text: 'Свечи для ужина', done: true }
      ]
    },
    {
      id: 'list-trip',
      name: '✈️ Собрать чемодан',
      order: 1,
      items: [
        { id: 'li-4', text: 'Паспорта', done: true },
        { id: 'li-5', text: 'Солнцезащитный крем', done: false },
        { id: 'li-6', text: 'Книга в дорогу', done: false },
        { id: 'li-7', text: 'Зарядки', done: false }
      ]
    }
  ],
  // 4 хотелки, одна исполнена (wish-3).
  wishes: [
    { id: 'wish-1', text: 'Кофемашина', link: '', owner: 'gosha', done: false, ts: Date.now() - 10 * 86400000 },
    { id: 'wish-2', text: 'Поездка к морю', link: '', owner: 'dasha', done: false, ts: Date.now() - 9 * 86400000 },
    { id: 'wish-3', text: 'Новые кроссовки', link: '', owner: 'gosha', done: true, doneBy: 'dasha', doneAt: Date.now() - 2 * 86400000, ts: Date.now() - 20 * 86400000 },
    { id: 'wish-4', text: 'Плейлист для двоих', link: 'https://example.com/playlist', owner: 'dasha', done: false, ts: Date.now() - 1 * 86400000 }
  ],
  labels: [
    { id: 'lbl-travel', name: 'Путешествия', color: '#3b82f6' },
    { id: 'lbl-family', name: 'Семья', color: '#10b981' },
    { id: 'lbl-food', name: 'Еда', color: '#f59e0b' }
  ],
  // 12 фото-заглушек с лейблами — в том числе служебными (события/свидания).
  photos: (function buildDemoPhotos() {
    const titles = [
      'На набережной',
      'Пикник в парке',
      'Вечер дома',
      'Поход в горы',
      'Семейный ужин',
      'Кофе с круассаном',
      'Первый снег',
      'Морской берег',
      'Годовщина',
      'Завтрак в кровати',
      'Свидание в кино',
      'Закат на крыше'
    ];
    const labelSets = [
      [],
      [DEMO_EVENT_LABEL],
      [DEMO_DATE_LABEL],
      ['lbl-travel'],
      ['lbl-family'],
      ['lbl-food'],
      [],
      ['lbl-travel', 'lbl-family'],
      [DEMO_EVENT_LABEL],
      ['lbl-food'],
      [DEMO_DATE_LABEL],
      ['lbl-travel']
    ];
    return titles.map((title, i) => ({
      id: 'photo-' + (i + 1),
      data: demoPhotoDataUrl(i),
      title,
      labels: labelSets[i],
      pinned: i === 0 || i === 4,
      ts: Date.now() - i * 43200000,
      order: i
    }));
  })()
};
