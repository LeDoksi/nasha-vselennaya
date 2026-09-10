/* ===== Разовый переезд из старого зашифрованного сейфа в Firestore =====
   Запускается сам при первом входе новой версии и безопасен при повторах:
   если в базе уже есть хоть один документ — не делает ничего.

   Старый блоб в Realtime Database НЕ удаляется: пока владелец своими глазами
   не подтвердит, что всё на месте, он остаётся нетронутой страховкой. */

function mdOf(dateIso) {
  return typeof dateIso === 'string' && dateIso.length >= 10 ? dateIso.slice(5, 10) : '';
}

// legacyData — РЕЗУЛЬТАТ успешной расшифровки старого сейфа (уже прогнанный
// через migrateDB(), со всеми преобразованиями схемы вроде альбомов→лейблов),
// переданный явно вызывающим кодом (unlockWithKey в src/01-gate.js), а НЕ
// угаданный по содержимому глобального db. Раньше функция сама смотрела на
// db и решала «похоже на данные — значит, есть что переносить»: но если
// расшифровка падала (не тот ключ, сейфа нет на этом устройстве), в игру
// вступал ЛЮБОЙ db, до какого успело докатиться выполнение (вплоть до
// defaultDB() — структуры с ОДНОЙ годовщиной-заглушкой «Мы начали
// встречаться»). По длине db.events такую заглушку было не отличить от
// настоящих данных: функция переносила эту одну годовщину и ставила флаг
// migrated. Второе устройство, на котором сейф расшифровывался нормально,
// видело флаг и уже НИЧЕГО не переносило — данные пары оставались запертыми в
// старом сейфе. Единственный, кто точно знает, удалась расшифровка или нет, —
// вызывающий код (строка с db = migrateDB(...) в unlockWithKey выполнится,
// только если расшифровка и разбор JSON не бросили исключение); он и обязан
// передать null явно на неудаче, а не заставлять эту функцию гадать.
async function migrateFromVaultIfNeeded(legacyData) {
  if (!fsReady) return false;
  if (!legacyData) return false; // расшифровка не удалась (или сейфа нет) — переносить нечего по определению

  // Флаг завершения — meta/settings.migrated. Батчи ниже идут по одному, БЕЗ
  // общей транзакции: если перенос оборвётся посередине (упала сеть, закрыли
  // вкладку), часть коллекций уже уедет в Firestore, а часть — нет. Флаг
  // ставится только после того, как ВСЕ батчи прошли успешно (см. конец
  // функции), поэтому именно он, а не проба ниже, — надёжный признак «перенос
  // точно закончен». Без него повторный запуск при обрыве на середине рисковал
  // бы навсегда пропустить то, что не успело доехать.
  const settings = await fsDoc().collection('meta').doc('settings').get();
  if (settings.exists && settings.data().migrated) return false;

  // Сейф расшифровался, но в нём и правда пусто (например, у новой пары) —
  // это законный «нечего переносить», не путать с неудачной расшифровкой
  // выше: флаг ниже не ставится, чтобы не означать «функция отработала
  // вхолостую» как «данные пары уехали».
  if (!(legacyData.events || []).length && !(legacyData.notes || []).length && !(legacyData.photos || []).length) return false;

  // Проба — доп. защита на случай «данные уже есть, а флага нет» (например,
  // перенос делала более старая версия кода, до появления флага). ВАЖНО
  // проверять ВСЕ семь переносимых коллекций, а не только notes/events как
  // было раньше (Critical-находка ревью): иначе один случайно уже переехавший
  // кусок навсегда прятал бы от повторного запуска всё остальное, что не
  // успело доехать при обрыве на середине.
  const targets = [
    ['events', legacyData.events],
    ['dates', legacyData.dates],
    ['notes', legacyData.notes],
    ['lists', legacyData.lists],
    ['wishes', legacyData.wishlist],
    ['labels', legacyData.labels],
    ['photos', legacyData.photos]
  ].filter(([, arr]) => (arr || []).length);
  const probes = await Promise.all(targets.map(([coll]) => fsCol(coll).limit(1).get()));
  if (targets.length && probes.every(p => p.docs.length)) {
    // Important-находка ревью: обрыв на хвосте после 7 коллекций оставляет
    // pushSubs неперенесёнными, но проба выше это не видит. Партнёр молча
    // перестаёт получать уведомления, если его подписка не доехала. Если
    // локально есть pushSubs, проверяем, что они уже в Firestore — иначе
    // перенос не полный и должен повториться.
    if (legacyData.pushSubs && Object.keys(legacyData.pushSubs).length) {
      const metaSnap = await fsDoc().collection('meta').doc('settings').get();
      const existingSubs = metaSnap.exists ? metaSnap.data().pushSubs || {} : {};
      if (!Object.keys(existingSubs).length) {
        // Есть локальные pushSubs, но в Firestore их нет — перенос незавершён.
        // Продолжаем выполнение (не возвращаем false), чтобы доперенести pushSubs.
      } else {
        return false;
      }
    } else {
      return false;
    }
  }

  // md нужен, чтобы годовщины находились независимо от года (см. спеку).
  const events = (legacyData.events || []).map(e => ({ ...e, md: mdOf(e.date) }));

  await repoBatch('events', events);
  await repoBatch('dates', legacyData.dates || []);
  await repoBatch('notes', legacyData.notes || []);
  await repoBatch('lists', legacyData.lists || []);
  await repoBatch('wishes', legacyData.wishlist || []);
  await repoBatch('labels', legacyData.labels || []);
  await repoBatch('photos', legacyData.photos || []);
  if (legacyData.pushSubs && Object.keys(legacyData.pushSubs).length) {
    await repoMeta({ pushSubs: legacyData.pushSubs });
  }
  // Флаг — только теперь, когда все батчи выше точно прошли успешно.
  await repoMeta({ migrated: true });
  console.warn('[migrate] данные перенесены в Firestore; старый сейф в RTDB оставлен как страховка');
  return true;
}
