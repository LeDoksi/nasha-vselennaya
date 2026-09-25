# Цифры до редизайна (baseline)

Замеры по состоянию на коммит перед редизайном. Все запуски выполнены на машине разработки без оптимизации CI.

---

## Вес сборки

### Размеры app.js после build.js

```
app.js (развёрнутый):  331 КБ
app.min.js (сжатый):   169 КБ
```

### Вес файлов, доставляемых на устройство

```
app.min.js                        173,350 bytes
styles.css                         77,085 bytes
index.html                         34,073 bytes
vendor/sortable.min.js             45,092 bytes
fonts/nunito-cyrillic.woff2        20,776 bytes
fonts/nunito-latin.woff2           39,128 bytes
fonts/yeseva-one-cyrillic.woff2    11,328 bytes
fonts/yeseva-one-latin.woff2       17,492 bytes
───────────────────────────────────────────
ИТОГО                            418,324 bytes (~408.5 КБ)
```

**Примечание:** Firebase Compatibility SDK загружается тремя отдельными тегами с `gstatic.com` и не входит в эту сумму. Lighthouse ниже снят со стенда (`tools/demo.html`), который Firebase не грузит вообще — его вес туда тоже не входит, см. раздел «Firebase» в конце документа.

---

## Покрытие кода

Результат `npm run coverage`:

```
Итого: 87.41%

По модулям:
  photo-sign/index.js   88.19%  (239/271 выражений)
  send-push/index.js    86.2%   (150/174 выражений)
```

**Примечание:** Отчёт c8 содержит ровно 2 файла (photo-sign, send-push) — это полный список модулей с явным покрытием. Основное ядро приложения (app.js и прочие модули) проверяются интеграционными тестами, но AST-покрытие для них не рассчитывается.

---

## Lighthouse: Desktop

*Методологическая оговорка: обе таблицы ниже сняты с `tools/demo.html`
(стенд с заглушкой входа/базы, без Firebase) — это НЕ production-вес, см.
раздел «Firebase» в конце документа.*

Профиль: `--preset=desktop`

| Метрика | Значение |
|---------|----------|
| Performance | 98 |
| LCP (Largest Contentful Paint) | 0.9 s |
| TBT (Total Blocking Time) | 0 ms |
| CLS (Cumulative Layout Shift) | 0.002 |
| **Вес передачи** | **592.4 КБ** |

*Примечание: INP не измеряется — на статической странице demo.html нет взаимодействия пользователя. Вместо INP указан TBT (Total Blocking Time).*

---

## Lighthouse: Mobile

Профиль: `--form-factor=mobile`

| Метрика | Значение |
|---------|----------|
| Performance | 73 |
| LCP (Largest Contentful Paint) | 4.6 s |
| TBT (Total Blocking Time) | 0 ms |
| CLS (Cumulative Layout Shift) | 0.003 |
| **Вес передачи** | **592.4 КБ** |

*Примечание: INP не измеряется — на статической странице demo.html нет взаимодействия пользователя. Вместо INP указан TBT (Total Blocking Time).*

---

## Firebase НЕ включён в вес передачи 592.4 КБ — это стенд, не прод

Lighthouse выше снят с `tools/demo.html` — стенда, который подключает
заглушку логина/базы вместо реальных Firebase-тегов (см. Task 1: стенд
специально работает офлайн, ноль сетевых запросов к `firestore.googleapis.com`
и `gstatic.com`). Значит **592.4 КБ — это вес стенда, а не production-сборки**,
и Firebase SDK в эту цифру не входит вообще, ни частично, ни полностью.

Реальная production-страница дополнительно грузит то, чего стенд не видит:

1. Firebase Compatibility SDK (compat, версия 10.14.0) тремя тегами с `gstatic.com`
   (`@firebase/app`, `@firebase/auth`, `@firebase/firestore`).

   Замер 25.09.2026 (`curl` с gstatic, `gzip -9`), firebase 10.14.0 compat:
   app 31.8 КБ / 10.0 КБ gz, auth 139.3 КБ / 39.4 КБ gz, firestore 343.8 КБ /
   101.3 КБ gz — **итого 515 КБ, 151 КБ gz**. Для сравнения: модульный SDK,
   собранный esbuild ровно под наши вызовы (initializeAuth + popup/redirect,
   Firestore с persistentLocalCache), — 124 КБ gz. Переход отложен (NV-46),
   выигрыш 27 КБ не окупает риск для входа.

2. `app.min.js` (169 КБ), а не `app.js` в развёрнутом виде (331 КБ, см.
   «Вес сборки» выше) — на проде отдаётся минифицированный файл.

**Методологическая оговорка на будущее (фаза 10):** сравнивать
production-вес с этим базлайном напрямую нельзя — обе стороны сравнения
должны быть либо стендом, либо продом. 592.4 КБ — это стенд; production
вес — это локальная сумма файлов (раздел «Вес передачи» выше, уже на
`app.min.js`) плюс 151 КБ gz Firebase SDK, которого стенд не грузит.

---

Отчёты Lighthouse в формате JSON находятся в этом же каталоге (`lh-desktop.json`, `lh-mobile.json`). Они не коммитятся в историю.
