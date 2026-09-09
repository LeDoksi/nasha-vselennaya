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
  // Уже мигрировали? Достаточно одного документа в любой смысловой коллекции.
  const probe = await fsCol('notes').limit(1).get();
  const probeEvents = await fsCol('events').limit(1).get();
  if (probe.docs.length || probeEvents.docs.length) return false;
  if (!db || (!(db.events || []).length && !(db.notes || []).length && !(db.photos || []).length)) return false;

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
  console.warn('[migrate] данные перенесены в Firestore; старый сейф в RTDB оставлен как страховка');
  return true;
}
