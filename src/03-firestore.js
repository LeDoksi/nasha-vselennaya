/* ===== Firestore: подключение и ссылки =====
   Единственное место, которое знает адрес данных в облаке. Всё остальное
   ходит через репозиторий (src/04-repo.js).

   Приложение Firebase и Google-вход к этому моменту уже готовы — их поднимает
   гейт (src/01-gate.js) раньше всех. Здесь только берём готовое.

   Офлайн-кэш включается сразу: именно он даёт мгновенное открытие при втором
   и последующих заходах — данные отдаются с диска ещё до обращения к сети. */

const FS_ROOT = ['couples', 'main']; // всё живёт под одним поддеревом — одно правило доступа на всё

function fsDoc() {
  return firebase.firestore(fbApp).collection(FS_ROOT[0]).doc(FS_ROOT[1]);
}
function fsCol(name) {
  return fsDoc().collection(name);
}

async function initFirestore() {
  const app = typeof ensureFbApp === 'function' ? ensureFbApp() : null;
  if (!app || typeof firebase.firestore !== 'function') {
    fsReady = false;
    return false;
  }
  try {
    // synchronizeTabs — чтобы две открытые вкладки не дрались за один кэш.
    // Ошибки тут не смертельны: без офлайн-кэша приложение просто ходит в сеть
    // каждый раз, поэтому глушим и продолжаем.
    await firebase.firestore(app).enablePersistence({ synchronizeTabs: true });
  } catch (e) {
    console.warn('[fs] офлайн-кэш недоступен, работаем только по сети', e && e.code);
  }
  fsReady = true;
  return true;
}
