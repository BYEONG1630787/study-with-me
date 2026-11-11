// 기기 안에서 도는 문서 저장소. platform의 `db`와 같은 모양(DB 타입)을 구현한다.
// 쓰임새: (1) db를 쓸 수 없을 때의 체험 모드, (2) 계정 id가 없는 사용자의 개인 설정 보관,
// (3) 테스트용 가짜 platform. 데이터는 IndexedDB에 두고, 같은 브라우저의 다른 탭과는
// BroadcastChannel로 맞춘다.

type Body = Record<string, unknown>;

export interface LocalDbOptions {
  name: string;
  viewerId: string | null;
  canWrite?: boolean;
  latency?: number;
}

interface Filter {
  field: string;
  op: string;
  value: unknown;
}

interface QuerySpec {
  path: string;
  filters: Filter[];
  order: { field: string; dir: 'asc' | 'desc' } | null;
  limit: number | null;
}

const SEG = /^[A-Za-z0-9_\-.~:@+]+$/;
const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

function byteLen(s: string): number {
  return enc ? enc.encode(s).length : s.length;
}

function checkPath(path: string, wantDoc: boolean): string[] {
  if (typeof path !== 'string' || !path) throw new TypeError('path must be a non-empty string');
  const segs = path.split('/');
  if (segs.length > 16) throw new TypeError('path has more than 16 segments');
  if (byteLen(path) > 1000) throw new TypeError('path is longer than 1000 bytes');
  for (const s of segs) {
    if (!s || s === '.' || s === '..' || !SEG.test(s) || byteLen(s) > 200) throw new TypeError(`bad path segment "${s}" in "${path}"`);
  }
  const even = segs.length % 2 === 0;
  if (wantDoc && !even) throw new TypeError(`"${path}" has ${segs.length} segments: a document path needs an even number`);
  if (!wantDoc && even) throw new TypeError(`"${path}" has ${segs.length} segments: a collection path needs an odd number`);
  return segs;
}

function isObj(v: unknown): v is Body {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

function merge(base: Body, patch: Body): Body {
  const out: Body = { ...base };
  for (const k of Object.keys(patch)) {
    const pv = patch[k];
    const bv = out[k];
    out[k] = isObj(pv) && isObj(bv) ? merge(bv, pv) : clone(pv);
  }
  return out;
}

function eq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'object' && typeof b === 'object' && a && b) return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

function cmp(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function comparable(a: unknown, b: unknown): boolean {
  return a !== undefined && a !== null && typeof a === typeof b;
}

function matches(body: Body, f: Filter): boolean {
  const v = body[f.field];
  switch (f.op) {
    case '==':
      return eq(v, f.value);
    case '!=':
      return v !== undefined && !eq(v, f.value);
    case '<':
      return comparable(v, f.value) && cmp(v, f.value) < 0;
    case '<=':
      return comparable(v, f.value) && cmp(v, f.value) <= 0;
    case '>':
      return comparable(v, f.value) && cmp(v, f.value) > 0;
    case '>=':
      return comparable(v, f.value) && cmp(v, f.value) >= 0;
    case 'in':
      return Array.isArray(f.value) && f.value.some((x) => eq(v, x));
    case 'not-in':
      return v !== undefined && Array.isArray(f.value) && !f.value.some((x) => eq(v, x));
    case 'array-contains':
      return Array.isArray(v) && v.some((x) => eq(x, f.value));
    default:
      return false;
  }
}

function err(code: DbErrorCode, message: string): DbError {
  return { code, message };
}

const META: SnapshotMetadata = Object.freeze({ fromCache: false, hasPendingWrites: false });

interface Sub {
  kind: 'doc' | 'query';
  path: string;
  fire: () => void;
}

class Engine {
  docs = new Map<string, Body>();
  subs = new Set<Sub>();
  snaps = new WeakMap<object, DocumentSnapshot>();
  idb: IDBDatabase | null = null;
  bc: BroadcastChannel | null = null;
  ready: Promise<void>;

  constructor(public opts: LocalDbOptions) {
    this.ready = this.open();
    try {
      this.bc = new BroadcastChannel('localdb:' + opts.name);
      this.bc.onmessage = (ev) => {
        const m = ev.data as { path: string; body: Body | null };
        if (!m || typeof m.path !== 'string') return;
        this.apply(m.path, m.body ? deepFreeze(m.body) : null, false);
      };
    } catch {
      this.bc = null;
    }
  }

  private open(): Promise<void> {
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      const timer = setTimeout(finish, 2000);
      try {
        const req = indexedDB.open('localdb:' + this.opts.name, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore('docs');
        };
        req.onerror = () => {
          clearTimeout(timer);
          finish();
        };
        req.onsuccess = () => {
          const db = req.result;
          try {
            const tx = db.transaction('docs', 'readonly');
            const store = tx.objectStore('docs');
            const cur = store.openCursor();
            cur.onsuccess = () => {
              const c = cur.result;
              if (c) {
                if (!this.docs.has(String(c.key)) && isObj(c.value)) this.docs.set(String(c.key), deepFreeze(c.value as Body));
                c.continue();
              }
            };
            tx.oncomplete = () => {
              this.idb = db;
              clearTimeout(timer);
              finish();
            };
            tx.onerror = tx.onabort = () => {
              clearTimeout(timer);
              finish();
            };
          } catch {
            clearTimeout(timer);
            finish();
          }
        };
      } catch {
        clearTimeout(timer);
        finish();
      }
    });
  }

  private persist(path: string, body: Body | null) {
    if (!this.idb) return;
    try {
      const store = this.idb.transaction('docs', 'readwrite').objectStore('docs');
      if (body) store.put(body, path);
      else store.delete(path);
    } catch {
      /* 저장 실패는 무시: 이번 방문 동안은 메모리에 남는다 */
    }
  }

  apply(path: string, body: Body | null, local: boolean) {
    if (body) this.docs.set(path, body);
    else this.docs.delete(path);
    if (local) {
      this.persist(path, body);
      try {
        this.bc?.postMessage({ path, body });
      } catch {
        /* ignore */
      }
    }
    const col = path.slice(0, path.lastIndexOf('/'));
    for (const s of [...this.subs]) {
      if ((s.kind === 'doc' && s.path === path) || (s.kind === 'query' && s.path === col)) s.fire();
    }
  }

  canSee(path: string): boolean {
    if (path.startsWith('data/users/')) return path.split('/')[2] === this.opts.viewerId;
    return true;
  }

  canWritePath(path: string): boolean {
    return this.opts.canWrite !== false && this.canSee(path);
  }

  wait(): Promise<void> {
    const ms = this.opts.latency ?? 0;
    return this.ready.then(() => new Promise<void>((r) => setTimeout(r, ms)));
  }

  snapOf(path: string): DocumentSnapshot {
    const id = path.slice(path.lastIndexOf('/') + 1);
    const body = this.canSee(path) ? this.docs.get(path) : undefined;
    if (!body) return Object.freeze({ id, exists: false, data: () => undefined, metadata: META });
    let s = this.snaps.get(body);
    if (!s) {
      s = Object.freeze({ id, exists: true, data: () => body, metadata: META });
      this.snaps.set(body, s);
    }
    return s;
  }

  run(q: QuerySpec): DocumentSnapshot[] {
    const prefix = q.path + '/';
    const depth = q.path.split('/').length + 1;
    const rows: { id: string; path: string; body: Body }[] = [];
    for (const [path, body] of this.docs) {
      if (!path.startsWith(prefix) || path.split('/').length !== depth) continue;
      if (!this.canSee(path)) continue;
      if (!q.filters.every((f) => matches(body, f))) continue;
      rows.push({ id: path.slice(prefix.length), path, body });
    }
    const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    if (q.order) {
      const { field, dir } = q.order;
      const sign = dir === 'desc' ? -1 : 1;
      rows.sort((a, b) => {
        const av = a.body[field];
        const bv = b.body[field];
        const am = av === undefined || av === null;
        const bm = bv === undefined || bv === null;
        if (am && bm) return byId(a, b);
        if (am) return 1;
        if (bm) return -1;
        return sign * cmp(av, bv) || byId(a, b);
      });
    } else rows.sort(byId);
    const lim = q.limit ?? Infinity;
    return rows.slice(0, lim).map((r) => this.snapOf(r.path));
  }
}

function makeQuerySnap(docs: DocumentSnapshot[], prev: DocumentSnapshot[] | null): QuerySnapshot {
  const changes = (): DocumentChange[] => {
    const out: DocumentChange[] = [];
    const before = prev ?? [];
    const oldIdx = new Map(before.map((d, i) => [d.id, i]));
    const newIdx = new Map(docs.map((d, i) => [d.id, i]));
    before.forEach((d, i) => {
      if (!newIdx.has(d.id)) out.push({ type: 'removed', doc: d, oldIndex: i, newIndex: -1 });
    });
    docs.forEach((d, i) => {
      const o = oldIdx.get(d.id);
      if (o === undefined) out.push({ type: 'added', doc: d, oldIndex: -1, newIndex: i });
      else if (before[o] !== d) out.push({ type: 'modified', doc: d, oldIndex: o, newIndex: i });
    });
    return out;
  };
  return Object.freeze({ docs, size: docs.length, empty: docs.length === 0, docChanges: changes, metadata: META });
}

function makeDoc(e: Engine, path: string): DocumentReference {
  checkPath(path, true);
  const id = path.slice(path.lastIndexOf('/') + 1);
  const guard = (body: unknown): Body => {
    if (!isObj(body)) throw err('invalid_argument', 'document body must be an object');
    const copy = clone(body);
    if (byteLen(JSON.stringify(copy)) > 256 * 1024) throw err('invalid_argument', 'document is larger than 256 KiB');
    return copy;
  };
  const ref: DocumentReference = {
    id,
    path,
    get: () => e.wait().then(() => e.snapOf(path)),
    set: (data) =>
      e.ready.then(() => {
        if (!e.canWritePath(path)) return e.wait().then(() => Promise.reject(err('invalid_argument', 'write not allowed at ' + path)));
        const body = deepFreeze(guard(data));
        e.apply(path, body, true);
        return e.wait();
      }),
    update: (data) =>
      e.ready.then(() => {
        if (!e.canWritePath(path)) return e.wait().then(() => Promise.reject(err('invalid_argument', 'write not allowed at ' + path)));
        const cur = e.docs.get(path);
        if (!cur) return e.wait().then(() => Promise.reject(err('invalid_argument', 'update of a missing document ' + path)));
        if (!isObj(data)) return Promise.reject(err('invalid_argument', 'document body must be an object'));
        const body = deepFreeze(guard(merge(cur, data)));
        e.apply(path, body, true);
        return e.wait();
      }),
    delete: () =>
      e.ready.then(() => {
        if (!e.canWritePath(path)) return e.wait().then(() => Promise.reject(err('invalid_argument', 'write not allowed at ' + path)));
        if (e.docs.has(path)) e.apply(path, null, true);
        return e.wait();
      }),
    acquire: (o) => e.wait().then(() => ({ acquired: true, holder: o.holder, expiresAt: new Date(Date.now() + (o.ttlMs || 30000)).toISOString() })),
    onSnapshot: (next) => {
      let last: DocumentSnapshot | null = null;
      let alive = true;
      const sub: Sub = {
        kind: 'doc',
        path,
        fire: () => {
          if (!alive) return;
          const s = e.snapOf(path);
          if (last && last === s) return;
          if (last && !last.exists && !s.exists) return;
          last = s;
          next(s);
        },
      };
      e.wait().then(() => {
        if (!alive) return;
        e.subs.add(sub);
        last = e.snapOf(path);
        next(last);
      });
      return () => {
        alive = false;
        e.subs.delete(sub);
      };
    },
    collection: (p) => makeCollection(e, path + '/' + p),
  };
  return ref;
}

function makeQuery(e: Engine, spec: QuerySpec): Query {
  return {
    where: (field, op, value) => makeQuery(e, { ...spec, filters: [...spec.filters, { field, op, value }] }),
    orderBy: (field, dir = 'asc') => makeQuery(e, { ...spec, order: { field, dir } }),
    limit: (n) => makeQuery(e, { ...spec, limit: n }),
    get: () => e.wait().then(() => makeQuerySnap(e.run(spec), null)),
    onSnapshot: (next) => {
      let last: DocumentSnapshot[] | null = null;
      let alive = true;
      const sub: Sub = {
        kind: 'query',
        path: spec.path,
        fire: () => {
          if (!alive) return;
          const docs = e.run(spec);
          if (last && last.length === docs.length && last.every((d, i) => d === docs[i])) return;
          const prev = last;
          last = docs;
          next(makeQuerySnap(docs, prev));
        },
      };
      e.wait().then(() => {
        if (!alive) return;
        e.subs.add(sub);
        last = e.run(spec);
        next(makeQuerySnap(last, null));
      });
      return () => {
        alive = false;
        e.subs.delete(sub);
      };
    },
  };
}

function randomId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 20; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function makeCollection(e: Engine, path: string): CollectionReference {
  checkPath(path, false);
  const q = makeQuery(e, { path, filters: [], order: null, limit: null });
  const doc = (id?: string) => makeDoc(e, path + '/' + (id ?? randomId()));
  return {
    ...q,
    path,
    doc,
    add: (data) => {
      const ref = doc();
      return ref.set(data).then(() => ref);
    },
  };
}

export function createLocalDb(opts: LocalDbOptions): DB {
  const e = new Engine(opts);
  return {
    doc: (path) => makeDoc(e, path),
    collection: (path) => makeCollection(e, path),
  };
}
