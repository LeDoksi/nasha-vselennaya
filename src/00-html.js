/* ===== Рендер разметки =====
   Единственный способ писать HTML в DOM. html`…` экранирует всё подставленное,
   кроме SafeHtml (результат другого html`` или raw()), поэтому экранирование —
   умолчание, а не решение в каждом месте. esc() внутри html`` не нужен: это
   было бы двойное экранирование («&amp;lt;» на экране). Страж —
   tests/uni-render.js. SafeHtml — наследник String: .includes(), конкатенация
   и ${} в обычном шаблоне работают как со строкой. render() тоже экранирует
   голую строку — не только html``/raw(). */
class SafeHtml extends String {}
const raw = s => new SafeHtml(s == null ? '' : s);
function htmlValue(v) {
  if (v instanceof SafeHtml) return String(v);
  if (Array.isArray(v)) return v.map(htmlValue).join('');
  if (v == null || v === false) return '';
  return esc(v);
}
const html = (strings, ...values) => raw(strings.reduce((out, s, i) => out + htmlValue(values[i - 1]) + s));
function render(el, content) {
  if (el) el.innerHTML = content instanceof SafeHtml ? String(content) : esc(content);
}
