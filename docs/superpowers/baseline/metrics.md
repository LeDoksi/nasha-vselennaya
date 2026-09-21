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

**Примечание:** Firebase Compatibility SDK загружается тремя отдельными тегами с `gstatic.com` и не входит в эту сумму. Его вес измерен через Lighthouse (см. ниже).

---

## Покрытие кода

Результат `npm run coverage`:

```
Итого: 87.41%

По модулям:
  photo-sign/index.js   88.19%  (239/271 выражений)
  send-push/index.js    86.2%   (150/174 выражений)
```

**Примечание:** Покрытие измеряется только для явно тестируемых модулей (photo-sign, send-push). Основное ядро приложения (app.js и модули) проверяются интеграционными тестами, но полное AST-покрытие не рассчитывается.

---

## Lighthouse: Desktop

Профиль: `--preset=desktop`

| Метрика | Значение |
|---------|----------|
| Performance | 98 |
| LCP (Largest Contentful Paint) | 0.9 s |
| TBT (Total Blocking Time) | 0 ms |
| CLS (Cumulative Layout Shift) | 0.002 |
| **Вес передачи** | **592.4 КБ** |

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

---

## Затраты Firebase (не входят в вес передачи выше)

Firebase SDK подключается через три `<script>` тега с `gstatic.com`:

1. `@firebase/app` — инициализация
2. `@firebase/auth` — аутентификация
3. `@firebase/firestore` — база данных

Общий объём этих скриптов (по данным Lighthouse): входит в значение **592.4 КБ** (вес всех внешних ресурсов). Точное разложение по модулям Firebase доступно в JSON-отчёте Lighthouse.

---

Отчёты Lighthouse в формате JSON находятся в этом же каталоге (`lh-desktop.json`, `lh-mobile.json`). Они не коммитятся в историю.
