/* Мок Firestore для тестов: хранит документы в обычном объекте
   { 'couples/main/events/abc': {...} } и повторяет ту часть API compat-SDK,
   которой пользуется src/04-repo.js. Специально НЕ повторяет всё подряд —
   только то, что реально вызывается, иначе мок становится вторым продуктом. */
'use strict';

function makeFsMock() {
  const store = {}; // путь → данные документа
  const listeners = []; // активные onSnapshot
  let idCounter = 0;
  let commitCount = 0; // сколько раз реально вызвали batch().commit() — тест проверяет, что нарезка по 400 действительно происходит
  let colGetCount = 0; // сколько раз реально выполнили запрос коллекции (colRef.get()) — тест на гонку loadMorePhotos проверяет, что параллельные вызовы не читают одну и ту же страницу дважды
  let forcedUpdateError = null; // { path, code } — одноразовая подмена ошибки update(), чтобы проверить проброс НЕ-not-found ошибок из repoMeta

  const clone = v => JSON.parse(JSON.stringify(v));
  const notify = () => listeners.forEach(l => l.fire());

  // Точечное обновление: { 'pushSubs.gosha': {...} } кладёт вглубь объекта
  function applyUpdate(target, patch) {
    for (const key of Object.keys(patch)) {
      const parts = key.split('.');
      let o = target;
      for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] = o[parts[i]] || {};
      const last = parts[parts.length - 1];
      if (patch[key] === '__DELETE__') delete o[last];
      else o[last] = patch[key];
    }
  }

  function docRef(path) {
    return {
      path,
      id: path.split('/').pop(),
      async set(data, opts) {
        store[path] = opts && opts.merge ? { ...(store[path] || {}), ...clone(data) } : clone(data);
        notify();
      },
      async update(patch) {
        if (forcedUpdateError && forcedUpdateError.path === path) {
          const err = new Error('forced test error: ' + forcedUpdateError.code);
          err.code = forcedUpdateError.code;
          forcedUpdateError = null;
          throw err;
        }
        if (!store[path]) {
          // Настоящий Firestore в этом случае даёт e.code === 'not-found' —
          // без кода repoMeta не смог бы отличить «документа нет» от прочих ошибок.
          const err = new Error('no document to update: ' + path);
          err.code = 'not-found';
          throw err;
        }
        applyUpdate(store[path], clone(patch));
        notify();
      },
      async delete() {
        delete store[path];
        notify();
      },
      async get() {
        const data = store[path];
        return { exists: !!data, id: path.split('/').pop(), data: () => (data ? clone(data) : undefined) };
      },
      onSnapshot(cb) {
        const l = { fire: () => cb({ exists: !!store[path], data: () => (store[path] ? clone(store[path]) : undefined) }) };
        listeners.push(l);
        l.fire();
        return () => {
          const i = listeners.indexOf(l);
          if (i >= 0) listeners.splice(i, 1);
        };
      },
      collection(name) {
        return colRef(path + '/' + name);
      }
    };
  }

  function colRef(path) {
    const query = { wheres: [], order: null, lim: 0, after: null };
    const api = {
      path,
      doc(id) {
        return docRef(path + '/' + (id || 'auto' + ++idCounter));
      },
      where(field, op, value) {
        query.wheres.push([field, op, value]);
        return api;
      },
      orderBy(field, dir) {
        query.order = [field, dir || 'asc'];
        return api;
      },
      limit(n) {
        query.lim = n;
        return api;
      },
      startAfter(cursor) {
        query.after = cursor;
        return api;
      },
      async get() {
        colGetCount++;
        return { docs: run() };
      },
      onSnapshot(cb) {
        const l = { fire: () => cb({ docs: run() }) };
        listeners.push(l);
        l.fire();
        return () => {
          const i = listeners.indexOf(l);
          if (i >= 0) listeners.splice(i, 1);
        };
      }
    };

    function run() {
      let rows = Object.keys(store)
        .filter(p => p.startsWith(path + '/') && p.slice(path.length + 1).indexOf('/') === -1)
        .map(p => ({ id: p.split('/').pop(), data: () => clone(store[p]), _raw: store[p] }));
      for (const [field, op, value] of query.wheres) {
        rows = rows.filter(r => {
          const v = r._raw[field];
          if (op === '==') return v === value;
          if (op === '>=') return v >= value;
          if (op === '<=') return v <= value;
          if (op === 'in') return Array.isArray(value) && value.includes(v);
          throw new Error('мок не умеет оператор ' + op);
        });
      }
      if (query.order) {
        const [f, dir] = query.order;
        rows.sort((a, b) => (a._raw[f] > b._raw[f] ? 1 : a._raw[f] < b._raw[f] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      if (query.after) {
        const i = rows.findIndex(r => r.id === query.after.id);
        if (i >= 0) rows = rows.slice(i + 1);
      }
      if (query.lim) rows = rows.slice(0, query.lim);
      return rows;
    }

    return api;
  }

  const firestore = () => ({
    collection: name => colRef(name),
    doc: path => docRef(path),
    enablePersistence: async () => {},
    batch() {
      const ops = [];
      return {
        // Третий аргумент opts (например {merge:true}) обязан пробрасываться
        // в ref.set(), иначе батч и одиночный set() будут вести себя по-разному,
        // и тесты могут не заметить ошибку в коде, полагаясь на мок.
        set: (ref, data, opts) => ops.push(() => ref.set(data, opts)),
        update: (ref, patch) => ops.push(() => ref.update(patch)),
        delete: ref => ops.push(() => ref.delete()),
        commit: async () => {
          commitCount++;
          for (const op of ops) await op();
        }
      };
    }
  });
  firestore.FieldValue = { delete: () => '__DELETE__' };

  return {
    firestore,
    _store: store,
    _listeners: listeners,
    get _commitCount() {
      return commitCount;
    },
    get _colGetCount() {
      return colGetCount;
    },
    _failNextUpdate(path, code) {
      forcedUpdateError = { path, code };
    }
  };
}

module.exports = { makeFsMock };
