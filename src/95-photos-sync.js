// Запуск сверки фото (debounce 1.2 с — было 2.5, снижено вместе с
// оптимизацией самой сверки: listIds() больше не читает блобы, а probe не
// перепроверяет уже свои фото, так что каждый прогон стал заметно дешевле):
// после добавления/удаления фото. Без Storage или до разблокировки — просто ждём.
function schedulePhotoSync() {
  if (!syncStorage || !photoStore || !masterKey || photoSyncing) return;
  clearTimeout(photoSyncTimer);
  photoSyncTimer = setTimeout(() => {
    syncPhotos().catch(e => console.warn('[photo-sync] сверка фото', e));
  }, 1200);
}

// Что сейчас лежит в облаке: { id: { orig: true, full: true, thumb: true } }
// Ошибку листинга намеренно НЕ глушим: «в облаке пусто» и «не смогли
// спросить» — разные вещи, а раньше они были неотличимы. Недоступное
// хранилище (VPN без нужного маршрута, провайдер, упавший бакет) выглядело
// как пустое облако: фото партнёра «нечего скачивать», плитка висела серой
// навсегда, sync молча крутился с трёхсекундным повтором, и ни одного слова
// человеку. Пусть лучше бросит — вызывающий покажет причину.
async function listCloudPhotos() {
  const out = {};
  for (const part of PHOTO_PARTS) {
    const res = await syncStorage.ref('photos/' + part).listAll();
    for (const it of res.items || []) (out[it.name] = out[it.name] || {})[part] = true;
  }
  return out;
}

// Выгрузка недостающих частей фото в облако (шифртекст как есть).
async function uploadCloudPhoto(id, cloud, local) {
  try {
    const meta = (await photoStore.getMeta(id).catch(() => null)) || {};
    const jobs = [];
    for (const part of PHOTO_PARTS) {
      const has = cloud[id] && cloud[id][part];
      if (has || !local['has' + part[0].toUpperCase() + part.slice(1)]) continue;
      jobs.push(
        (async () => {
          const getter = part === 'orig' ? 'getEncryptedOrig' : part === 'full' ? 'getEncryptedFull' : 'getEncryptedThumb';
          const enc = await photoStore[getter](id);
          if (!enc) return;
          // Обёртка: сам шифртекст + несекретные MIME/размер (размер и так виден
          // в метаданных Storage), чтобы на другом устройстве восстановить тип файла.
          const payload = { e: enc, m: { t: meta.origType || meta.type || '', ft: meta.type || '', st: meta.thumbType || '', s: meta.size || 0 } };
          await photoRef(part, id).put(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
        })()
      );
    }
    await Promise.all(jobs);
    return { ok: true };
  } catch (e) {
    console.warn('[photo-sync] не удалось выгрузить фото ' + id, e);
    return { ok: false, err: e };
  }
}

// Эagerная докачка миниатюр пачками (NV-7): вместо downloadCloudPhoto по
// одному id (который сам по себе дёргает presign на каждую часть) — один
// batch-запрос подписи на BATCH_SIZE миниатюр сразу, потом сами байты
// параллельно (mapLimit, тот же SYNC_CONCURRENCY, что и раньше).
const THUMB_BATCH_SIZE = 100; // совпадает с MAX_BATCH_ITEMS на стороне функции
async function downloadThumbsBatch(ids) {
  const stats = { downloaded: 0, failed: 0 };
  for (let i = 0; i < ids.length; i += THUMB_BATCH_SIZE) {
    const chunk = ids.slice(i, i + THUMB_BATCH_SIZE);
    let results;
    try {
      results = await syncStorage.batchPresignGet(chunk.map(id => ({ part: 'thumb', id })));
    } catch (e) {
      console.warn('[photo-sync] batch-подпись миниатюр не удалась', e);
      stats.failed += chunk.length;
      continue;
    }
    await mapLimit(results, SYNC_CONCURRENCY, async r => {
      if (!r || r.error || !r.url) {
        stats.failed++;
        return;
      }
      try {
        const res = await fetch(r.url);
        if (!res.ok) throw new Error('S3 ' + res.status + ' thumb/' + r.id);
        const txt = await res.text();
        const decoded = decodeCloudPartBody(txt);
        if (!decoded) throw new Error('незнакомый формат облачного файла');
        await withPhotoWriteLock(r.id, async () => {
          const meta = (await photoStore.getMeta(r.id).catch(() => null)) || {};
          const meta2 = mergeCloudMeta(meta, decoded.meta);
          const exFull = await photoStore.getEncryptedFull(r.id).catch(() => null);
          const exOrig = await photoStore.getEncryptedOrig(r.id).catch(() => null);
          await photoStore.putEncrypted(r.id, exFull, decoded.enc, meta2, exOrig);
        });
        try {
          const t = await photoStore.getThumb(r.id);
          if (t) setThumbUrl(r.id, await blobToDataUrl(t));
        } catch (e) {}
        stats.downloaded++;
      } catch (e) {
        console.warn('[photo-sync] не удалось докачать миниатюру ' + r.id, e);
        stats.failed++;
      }
    });
  }
  return stats;
}

// Параллельно выполняет fn по items, не более limit одновременно — чтобы
// сверка N фото не шла строго по одному (было так — первый вход на новом
// устройстве с большой галереей качал бы фото поштучно), но и не открывала
// сотни запросов разом (лимит бережёт Cloud Function и сеть телефона).
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
const SYNC_CONCURRENCY = 4;

// Проверяет облачные фото по одному: расшифровываются ли они текущим ключом.
// Берём самую «лёгкую» часть (миниатюра < показ-версия < оригинал) и пробуем
// расшифровать. Возвращает { foreign, unknown }:
//  - foreign: Map<id, part> — фото реально зашифровано ДРУГИМ ключом. Его не
//    трогаем никогда: ни скачивать, ни удалять.
//  - unknown: Map<id, err> — временный сбой (сеть/JSON/незнакомый формат). Фото
//    не трогаем в этом проходе, синхронизация повторится позже.
// Важно: фото чужого ключа НЕ блокируют синхронизацию остальных — иначе один
// «чужой» файл навсегда заморозил бы и скачивание наших фото, и их выгрузку.
async function probeCloudKeys(cloud) {
  const foreign = new Map();
  const unknown = new Map();
  for (const id of Object.keys(cloud)) {
    const part = ['thumb', 'full', 'orig'].find(p => cloud[id] && cloud[id][p]);
    if (!part) continue;
    try {
      const data = await photoRef(part, id).getBlob();
      const txt = typeof data === 'string' ? data : await data.text();
      const parsed = JSON.parse(txt);
      const enc = parsed && parsed.e && typeof parsed.e.d === 'string' ? parsed.e : parsed && typeof parsed.d === 'string' ? parsed : null;
      if (!enc) throw new Error('незнакомый формат облачного файла');
      await aesDec(masterKey, enc);
    } catch (e) {
      // Криптографический сбой (неверный ключ/IV/шифртекст) — фото «чужое».
      // Любая другая ошибка (сеть, JSON) — временная, помечаем unknown.
      const emsg = String((e && e.message) || e);
      if (e && (e.name === 'OperationError' || /decrypt/i.test(emsg))) {
        console.warn('[photo-sync] облачное фото не расшифровывается текущим ключом', id, part);
        foreign.set(id, part);
      } else {
        unknown.set(id, e);
      }
    }
  }
  return { foreign, unknown };
}

// Полная сверка фото: локальный store ↔ облако ↔ db.photos.
async function syncPhotos() {
  if (!syncStorage || !photoStore || !masterKey || photoSyncing) return;
  photoSyncing = true;
  const stats = { downloaded: 0, uploaded: 0, failed: 0, retry: false, retrySoon: false };
  try {
    const localList = await photoStore.listIds();
    const localMap = new Map(localList.map(l => [l.id, l]));
    let cloud;
    try {
      cloud = await listCloudPhotos();
    } catch (e) {
      console.warn('[photo-sync] хранилище фото недоступно', e);
      if (!cloudDownNotified) {
        cloudDownNotified = true;
        notify('Фото не синхронизируются: хранилище недоступно. Проверь интернет или VPN 💜', true);
      }
      stats.retry = true;
      return; // finally поставит повтор — сеть может вернуться сама
    }
    cloudDownNotified = false;
    // Фото хотелок в галерею (db.photos) не входят (осознанно, чтобы не
    // засорять «Наши моменты» скриншотами подарков), но синхронизировать их
    // между устройствами всё равно нужно — иначе партнёр не увидит фото
    // хотелки на своём телефоне. Добавляем их id в want отдельно.
    const want = new Set([...(db.photos || []).map(p => p && p.id).filter(Boolean), ...(db.wishlist || []).map(w => w && w.photoId).filter(Boolean)]);
    const hasPart = (id, part) => {
      const l = localMap.get(id);
      return !!(l && l['has' + part[0].toUpperCase() + part.slice(1)]);
    };
    // Проверяем расшифровку не для ВСЕХ облачных фото, а только для тех, что
    // ещё не доказаны своими: если id уже в db.photos (want) и все части,
    // которые мы вообще качаем эagerно (EAGER_DOWNLOAD_PARTS — сейчас только
    // thumb, см. Task 8), уже лежат у нас локально — мы их когда-то сами
    // расшифровали (создали или уже скачали), повторный запрос+расшифровка
    // ничего нового не скажут. full/orig сюда не входят намеренно: их эта
    // ветка больше не качает эagerно вообще, поэтому требовать их локального
    // наличия означало бы вечный re-probe фото партнёра (см. регрессию C1).
    // Проверяем только новое/неполное — кандидатов на скачивание и на
    // возможную чистку «мусора».
    const toProbe = {};
    for (const id of Object.keys(cloud)) {
      const fullyLocalAndWanted = want.has(id) && EAGER_DOWNLOAD_PARTS.every(part => !cloud[id][part] || hasPart(id, part));
      if (!fullyLocalAndWanted) toProbe[id] = cloud[id];
    }
    // Чужое (другой ключ) НЕ блокирует синхронизацию остальных: свои фото
    // скачиваем и выгружаем, а чужие просто не трогаем. Раньше одно «чужое»
    // фото прерывало всю сверку — и свои фото навсегда оставались
    // невыгруженными и нескачанными (deadlock на телефоне).
    const probe = Object.keys(toProbe).length ? await probeCloudKeys(toProbe) : { foreign: new Map(), unknown: new Map() };
    const isSkipped = id => probe.foreign.has(id) || probe.unknown.has(id);
    if (probe.foreign.size) {
      // Тоста намеренно нет: «чужие» файлы в бакете — это обычно остатки от
      // прежнего ключа, человеку с ними делать нечего, а всплывающая ошибка
      // при каждом входе только пугает. Молча пропускаем, след — в консоли.
      console.warn('[photo-sync] в облаке фото с другим ключом (' + probe.foreign.size + ' шт) — их не трогаю, свои фото синхронизирую');
    }
    if (probe.unknown.size) stats.retry = true; // сеть/формат — повторим позже
    // 1. Локальный мусор: блоб без фото в db (фото удалено) — чистим store
    for (const id of localMap.keys()) {
      if (want.has(id)) continue;
      try {
        await photoStore.delete(id);
        thumbCache.delete(id);
      } catch (e) {}
    }
    // 2. Облачный мусор: удаляем ТОЛЬКО если облако целиком «наше». Если есть
    //    хоть одно чужое/непроверенное фото — удаление отменяется: «мусором»
    //    могут оказаться чужие данные, их не трогаем.
    if (!probe.foreign.size && !probe.unknown.size) {
      for (const id of Object.keys(cloud)) {
        if (want.has(id)) continue;
        for (const part of PHOTO_PARTS) {
          if (cloud[id][part]) {
            try {
              await photoRef(part, id).delete();
            } catch (e) {}
          }
        }
      }
    }
    // 3. Скачиваем недостающее с облака (кроме чужих и временно недоступных) —
    //    параллельно, не более SYNC_CONCURRENCY фото одновременно.
    const toDownload = [...want].filter(id => {
      if (isSkipped(id)) return false;
      return EAGER_DOWNLOAD_PARTS.some(part => cloud[id] && cloud[id][part] && !hasPart(id, part));
    });
    // Гонка с другим устройством: запись о фото (в базе) обычно долетает
    // быстрее, чем сам файл (сама запись — маленький документ Firestore, а
    // файл ещё грузится presign+PUT). Если id есть в db.photos, но НИ
    // локально, НИ в облаке пока ничего нет — это не «нечего скачивать», а
    // «другое устройство ещё грузит», и без специальной обработки sync тихо
    // завершался бы успешно, ничего не скачав, и не повторялся бы — фото так
    // и оставалось «битым», пока кто-то не нажмёт «Синхронизировать сейчас»
    // вручную. Планируем быстрый повтор (см. finally), а не 20-секундный, как
    // при настоящих сбоях.
    const pendingElsewhere = [...want].some(id => {
      const l = localMap.get(id);
      const hasAnyLocal = !!(l && (l.hasFull || l.hasThumb || l.hasOrig));
      const hasAnyCloud = !!(cloud[id] && PHOTO_PARTS.some(p => cloud[id][p]));
      return !hasAnyLocal && !hasAnyCloud;
    });
    if (pendingElsewhere) stats.retrySoon = true;
    const thumbStats = await downloadThumbsBatch(toDownload);
    stats.downloaded += thumbStats.downloaded;
    if (thumbStats.failed) {
      stats.failed += thumbStats.failed;
      stats.retry = true;
    }
    // 4. Выгружаем недостающее в облако (новые фото + бэкфилл старых) —
    //    тоже параллельно.
    const toUpload = [...want].filter(id => {
      const l = localMap.get(id);
      return l && l.hasFull;
    });
    await mapLimit(toUpload, SYNC_CONCURRENCY, async id => {
      const res = await uploadCloudPhoto(id, cloud, localMap.get(id));
      if (res && res.ok) stats.uploaded++;
      else {
        stats.failed++;
        stats.retry = true;
      }
    });
    if (stats.failed) {
      notify('Часть фото не синхронизировалась — проверь интернет, повторю через минуту 💜', true);
    }
  } catch (e) {
    console.warn('[photo-sync] сверка фото не удалась', e);
  } finally {
    photoSyncing = false;
    // Докачали блобы из облака — прогреваем кэш миниатюр и перерисовываем вьюхи,
    // иначе миниатюры, приехавшие после первого рендера, не появятся в галерее.
    if (typeof warmThumbCache === 'function') warmThumbCache();
    // Ждём файл, который вот-вот появится (другое устройство ещё грузит) —
    // проверяем часто и недолго, а не 20 секунд, как при настоящих сбоях.
    if (stats.retrySoon) {
      clearTimeout(photoSyncTimer);
      photoSyncTimer = setTimeout(() => {
        syncPhotos().catch(e => console.warn('[photo-sync] сверка фото', e));
      }, 3000);
    } else if (stats.retry) {
      // Были временные сбои (сеть, чужой формат и т.п.) — попробуем ещё раз через 20 секунд.
      clearTimeout(photoSyncTimer);
      photoSyncTimer = setTimeout(() => {
        syncPhotos().catch(e => console.warn('[photo-sync] сверка фото', e));
      }, 20000);
    }
  }
}

/* ===== Старт приложения =====
   boot() из src/01-gate.js вызывается здесь — последним в сборке: он (через
   ensureFbApp) читает FIREBASE_CONFIG (let из этого модуля), который ещё в
   «мёртвой зоне» во время выполнения 01-gate.js. Boot запускает Google-гейт,
   а он уже сам ведёт к unlockApp(). */
boot();
