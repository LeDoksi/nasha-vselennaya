/* ===== Настройки ===== */
function renderSettings() {
  renderPushSettings(); // модуль 96-push.js — асинхронно проверяет текущую PushManager-подписку
  // Личный кабинет: какой Google-аккаунт вошёл
  const gi = $('#gateAccountInfo');
  if (gi) gi.textContent = gateUser && gateUser.email ? gateUser.email + (getUser() === 'dasha' ? ' (Даша)' : ' (Гоша)') : '—';
}
/* Копия данных: обычный JSON. Раньше выгружался зашифрованный сейф, но сейфа
   больше нет — данные живут в Firestore под защитой правил доступа. Фото
   кладём как есть: они и так зашифрованы, расшифровывать их ради бэкапа
   бессмысленно. */
async function exportData() {
  let photoSection = null;
  if (photoStore) {
    try {
      const blobs = await photoStore.exportBlobs();
      if (blobs.length) photoSection = { ver: 1, blobs };
    } catch (e) {
      console.warn('Не удалось собрать фото для бэкапа', e);
    }
  }
  const out = {
    ver: 2,
    savedAt: Date.now(),
    events: db.events || [],
    dates: db.dates || [],
    notes: db.notes || [],
    lists: db.lists || [],
    wishlist: db.wishlist || [],
    labels: db.labels || [],
    photos: db.photos || [],
    pushSubs: db.pushSubs || {}
  };
  if (photoSection) out.photos_blobs = photoSection;
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  a.download = `nasha-vselennaya-backup-${d.getFullYear()}-${mo}-${da}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  return out;
}
$('#exportBtn').addEventListener('click', () => {
  exportData();
});
/* Восстановление из копии: заливаем обратно в Firestore. Старый формат
   (зашифрованный сейф с полем keys) больше не поддерживается — он не
   расшифровывается без пароля, которого в новой версии нет вовсе.
   Возвращает: true — успех, 'format' — копия не того формата (сообщение уже
   показано здесь), 'cancel' — человек отказался на подтверждении, null —
   настоящая ошибка чтения/разбора файла (поймана в catch). Четыре разных
   исхода нужны вызывающему коду в #importInput, чтобы не показывать поверх
   уже понятного сообщения ещё и общий «не получилось прочитать файл» —
   именно так раньше вылезали два алерта подряд (РЕВЬЮ задачи 12, находка 1). */
async function importData(text) {
  try {
    const d = JSON.parse(text);
    if (!d || d.ver !== 2) {
      alert('Это копия старого формата — восстановить её эта версия уже не умеет.');
      return 'format';
    }
    // РЕВЬЮ задачи 12 (Important, находка 3): импорт целиком перезаписывает
    // pushSubs — если партнёр переподписался между экспортом и импортом, его
    // новая подписка тихо откатится к состоянию на момент копии. Ошибки на
    // экране при этом не будет, поэтому предупреждаем заранее и явно.
    if (!confirm('Копия заменит текущие данные — события, свидания, заметки, списки, хотелки, лейблы, фото и настройки уведомлений — тем, что было на момент её создания. Продолжить?')) {
      return 'cancel';
    }
    await repoBatch('events', d.events || []);
    await repoBatch('dates', d.dates || []);
    await repoBatch('notes', d.notes || []);
    await repoBatch('lists', d.lists || []);
    await repoBatch('wishes', d.wishlist || []);
    await repoBatch('labels', d.labels || []);
    await repoBatch('photos', d.photos || []);
    if (d.pushSubs && Object.keys(d.pushSubs).length) await repoMeta({ pushSubs: d.pushSubs });
    if (d.photos_blobs && d.photos_blobs.ver === 1 && Array.isArray(d.photos_blobs.blobs) && photoStore) {
      try {
        await photoStore.importBlobs(d.photos_blobs.blobs);
      } catch (e) {
        console.warn('Не удалось восстановить фото', e);
      }
    }
    await loadHotSet();
    return true;
  } catch (err) {
    return null;
  }
}
$('#importInput').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const fr = new FileReader();
  fr.onload = async () => {
    const result = await importData(fr.result); // ждём и сейф, и фото-блобы
    if (result === true) {
      e.target.value = '';
      location.reload();
    } else if (result === null) {
      // именно ошибка чтения/разбора файла — importData ничего пользователю не показала
      alert('Не получилось прочитать файл:(');
    }
    // result === 'format' или 'cancel' — importData уже объяснила пользователю,
    // что происходит (неверный формат копии или отказ на подтверждении),
    // повторный алерт здесь только запутал бы
  };
  fr.readAsText(f);
});
/* ===== Настройки: уменьшенное движение =====
   data-motion на <html>: 'reduced' — анимации всегда выключены, 'full' — всегда
   включены (перекрывает систему). Без атрибута — уважаем prefers-reduced-motion. */
const MOTION_KEY = 'universe_motion';
function getMotion() {
  const v = store.get(MOTION_KEY);
  return v === 'reduced' || v === 'full' ? v : null;
}
function applyMotion(m) {
  const doc = document.documentElement;
  if (!doc || !doc.dataset) return;
  if (m === 'reduced' || m === 'full') doc.dataset.motion = m;
  else {
    try {
      doc.removeAttribute('data-motion');
    } catch (e) {}
    try {
      delete doc.dataset.motion;
    } catch (e) {}
  }
  const t = $('#motionToggle');
  if (t) t.checked = m === 'reduced';
}
function setMotion(m) {
  const v = m === 'reduced' ? 'reduced' : 'full';
  store.set(MOTION_KEY, v);
  applyMotion(v);
}
function motionReduced() {
  const doc = document.documentElement;
  if (doc && doc.dataset) {
    if (doc.dataset.motion === 'reduced') return true;
    if (doc.dataset.motion === 'full') return false;
  }
  try {
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  } catch (e) {}
  return false;
}
const mt = $('#motionToggle');
if (mt) mt.addEventListener('change', e => setMotion(e.target.checked ? 'reduced' : 'full'));
