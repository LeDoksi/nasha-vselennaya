/* ===== Разовый переезд из старого зашифрованного сейфа в Firestore =====
   Запускается сам при первом входе новой версии и безопасен при повторах:
   если в базе уже есть хоть один документ — не делает ничего.

   Старый блоб в Realtime Database НЕ удаляется: пока владелец своими глазами
   не подтвердит, что всё на месте, он остаётся нетронутой страховкой. */

function mdOf(dateIso) {
  return typeof dateIso === 'string' && dateIso.length >= 10 ? dateIso.slice(5, 10) : '';
}

async function migrateFromVaultIfNeeded() {
  if (!fsReady) return false;

  // Флаг завершения — meta/settings.migrated. Батчи ниже идут по одному, БЕЗ
  // общей транзакции: если перенос оборвётся посередине (упала сеть, закрыли
  // вкладку), часть коллекций уже уедет в Firestore, а часть — нет. Флаг
  // ставится только после того, как ВСЕ батчи прошли успешно (см. конец
  // функции), поэтому именно он, а не проба ниже, — надёжный признак «перенос
  // точно закончен». Без него повторный запуск при обрыве на середине рисковал
  // бы навсегда пропустить то, что не успело доехать.
  const settings = await fsDoc().collection('meta').doc('settings').get();
  if (settings.exists && settings.data().migrated) return false;

  if (!db || (!(db.events || []).length && !(db.notes || []).length && !(db.photos || []).length)) return false;

  // Проба — доп. защита на случай «данные уже есть, а флага нет» (например,
  // перенос делала более старая версия кода, до появления флага). ВАЖНО
  // проверять ВСЕ семь переносимых коллекций, а не только notes/events как
  // было раньше (Critical-находка ревью): иначе один случайно уже переехавший
  // кусок навсегда прятал бы от повторного запуска всё остальное, что не
  // успело доехать при обрыве на середине.
  const targets = [
    ['events', db.events],
    ['dates', db.dates],
    ['notes', db.notes],
    ['lists', db.lists],
    ['wishes', db.wishlist],
    ['labels', db.labels],
    ['photos', db.photos]
  ].filter(([, arr]) => (arr || []).length);
  const probes = await Promise.all(targets.map(([coll]) => fsCol(coll).limit(1).get()));
  if (targets.length && probes.every(p => p.docs.length)) return false;

  // md нужен, чтобы годовщины находились независимо от года (см. спеку).
  const events = (db.events || []).map(e => ({ ...e, md: mdOf(e.date) }));

  await repoBatch('events', events);
  await repoBatch('dates', db.dates || []);
  await repoBatch('notes', db.notes || []);
  await repoBatch('lists', db.lists || []);
  await repoBatch('wishes', db.wishlist || []);
  await repoBatch('labels', db.labels || []);
  await repoBatch('photos', db.photos || []);
  if (db.pushSubs && Object.keys(db.pushSubs).length) {
    await repoMeta({ pushSubs: db.pushSubs });
  }
  // Флаг — только теперь, когда все батчи выше точно прошли успешно.
  await repoMeta({ migrated: true });
  console.warn('[migrate] данные перенесены в Firestore; старый сейф в RTDB оставлен как страховка');
  return true;
}
