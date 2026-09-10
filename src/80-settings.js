/* ===== Настройки ===== */
/* ===== Настройки: резервная копия и место в браузере ===== */
function renderSettings() {
  const bytes = new Blob([JSON.stringify(db)]).size || JSON.stringify(db).length;
  const kb = Math.max(1, Math.round(bytes / 1024));
  const si = $('#storageInfo');
  if (si) si.textContent = kb >= 1024 ? (kb / 1024).toFixed(1) + ' МБ' : kb + ' КБ';
  // Фото-хранилище (IndexedDB) считаем асинхронно и показываем отдельной строкой
  if (photoStore) {
    photoStore
      .refreshSizes()
      .then(sz => {
        const fk = Math.max(1, Math.round((sz.bytes || 0) / 1024));
        const fs = $('#photoStorageInfo');
        if (fs) fs.textContent = `${sz.count} фото · ${fk >= 1024 ? (fk / 1024).toFixed(1) + ' МБ' : fk + ' КБ'}`;
      })
      .catch(() => {});
  }
  const hint = $('#backupHint');
  if (!hint) return;
  // Статус облачной синхронизации (модуль 95-sync.js)
  if (typeof renderSyncStatus === 'function') renderSyncStatus(syncUiState, syncUiTs);
  renderPushSettings(); // модуль 96-push.js — асинхронно проверяет текущую PushManager-подписку
  if (!db.backupDate) {
    hint.innerHTML = '<span style="color:#d97706;font-weight:700;font-size:14px">⚠️ Резервная копия ещё не делалась. Нажми «Скачать копию» — так ничего не потеряется.</span>';
  } else {
    const days = Math.floor((Date.now() - db.backupDate) / 86400000);
    hint.innerHTML =
      days >= 30
        ? `<span style="color:#d97706;font-weight:700;font-size:14px">⚠️ Последняя копия была ${days} дн. назад. Самое время обновить её.</span>`
        : `<span style="color:#059669;font-weight:700;font-size:14px">✅ Копия сделана ${days === 0 ? 'сегодня' : days + ' дн. назад'}. Всё под защитой.</span>`;
  }
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
   расшифровывается без пароля, которого в новой версии нет вовсе. */
async function importData(text) {
  try {
    const d = JSON.parse(text);
    if (!d || d.ver !== 2) {
      alert('Это копия старого формата — восстановить её эта версия уже не умеет.');
      return null;
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
    const ok = await importData(fr.result); // ждём и сейф, и фото-блобы
    if (!ok) {
      alert('Не получилось прочитать файл:(');
      return;
    }
    e.target.value = '';
    location.reload();
  };
  fr.readAsText(f);
});
$('#resetBtn').addEventListener('click', () => {
  if (confirm('Точно удалить ВСЕ данные? Это не отменить.')) {
    store.remove(VAULT_KEY);
    store.remove(KEY);
    location.reload();
  }
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
