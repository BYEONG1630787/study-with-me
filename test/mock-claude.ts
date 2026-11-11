// 테스트용 가짜 window.claude. 주소의 쿼리로 사용자를 고른다.
//
//   ?u=mina            사용자 id (u_mina)
//   &role=editor       owner | editor | viewer(읽기 전용) | none(claude 없음)
//   &noid=1            계정 id를 주지 않는 편집자
//   &noassets=1        파일 저장소가 없는 화면
//   &space=a           데이터 공간 이름(시나리오마다 따로 쓰려고)
//   &lat=20            저장소 응답 지연(ms)
//   &hang=1            claude.use 가 10초 뒤 null 을 주는 경우
//   &canunknown=1      쓰기 가능 여부를 알려 주지 않는 경우(써 봐야 안다)
//   &slowsettings=800   개인 설정 문서의 구독 응답만 늦게 오는 경우(ms)
//
// 테스트 코드에서 window.__killSubs() 를 부르면 열려 있는 구독을 모두 끊는다
// (플랫폼이 구독을 끝내고 unavailable 을 알리는 상황).

import { createLocalDb } from '../src/localdb';

const q = new URLSearchParams(location.search);
const role = q.get('role') ?? 'editor';

if (role !== 'none') {
  const noid = q.get('noid') === '1';
  const viewerId = noid ? null : 'u_' + (q.get('u') ?? 'me');
  const canWrite = role === 'owner' || role === 'editor';
  const lat = Number(q.get('lat') ?? '15');
  const space = q.get('space') ?? 'main';
  const hang = q.get('hang') === '1';

  const raw = createLocalDb({ name: 'sw-mock-' + space, viewerId, canWrite, latency: lat });

  // ---- 구독을 감싸서 늦추거나 끊을 수 있게 한다 ----
  const slowSettings = Number(q.get('slowsettings') ?? '0');
  const live = new Set<() => void>();
  let opened = 0;
  function sub<S>(path: string, open: (next: (snap: S) => void, error?: (e: DbError) => void) => Unsubscribe, next: (snap: S) => void, error?: (e: DbError) => void): Unsubscribe {
    let dead = false;
    opened++;
    const delay = slowSettings && path.endsWith('/settings') ? slowSettings : 0;
    const unsub = open(
      (snap) => {
        if (dead) return;
        if (delay) setTimeout(() => !dead && next(snap), delay);
        else next(snap);
      },
      (e) => {
        if (!dead) error?.(e);
      },
    );
    const kill = () => {
      if (dead) return;
      dead = true;
      live.delete(kill);
      unsub();
      error?.({ code: 'unavailable', message: 'mock: host stopped answering' });
    };
    live.add(kill);
    return () => {
      dead = true;
      live.delete(kill);
      unsub();
    };
  }
  function wrapQuery(qy: Query, path: string): Query {
    return {
      where: (f, op, v) => wrapQuery(qy.where(f, op, v), path),
      orderBy: (f, d) => wrapQuery(qy.orderBy(f, d), path),
      limit: (n) => wrapQuery(qy.limit(n), path),
      get: () => qy.get(),
      onSnapshot: (next, error) => sub(path, (n, e) => qy.onSnapshot(n, e), next, error),
    };
  }
  function wrapCol(c: CollectionReference): CollectionReference {
    return { ...wrapQuery(c, c.path), path: c.path, doc: (id) => wrapDoc(c.doc(id)), add: async (data) => wrapDoc(await c.add(data)) };
  }
  function wrapDoc(d: DocumentReference): DocumentReference {
    return {
      id: d.id,
      path: d.path,
      get: () => d.get(),
      set: (x) => d.set(x),
      update: (x) => d.update(x),
      delete: () => d.delete(),
      acquire: (o) => d.acquire(o),
      onSnapshot: (next, error) => sub(d.path, (n, e) => d.onSnapshot(n, e), next, error),
      collection: (path) => wrapCol(d.collection(path)),
    };
  }
  const db: DB = { doc: (path) => wrapDoc(raw.doc(path)), collection: (path) => wrapCol(raw.collection(path)) };
  const hooks = window as unknown as { __killSubs: () => number; __subsOpened: () => number };
  hooks.__killSubs = () => {
    const n = live.size;
    for (const kill of [...live]) kill();
    return n;
  };
  hooks.__subsOpened = () => opened;

  const user = {
    id: async () => viewerId,
    can: async (cap: string) => (cap === 'data.write' && q.get('canunknown') !== '1' ? canWrite : null),
    isOwner: async () => role === 'owner',
    canEdit: async () => canWrite,
  };

  const OK = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'video/mp4',
    'video/webm',
    'application/pdf',
    'font/woff2',
    'font/woff',
    'font/ttf',
    'font/otf',
    'text/csv',
    'text/markdown',
    'application/json',
    'text/plain',
    'text/css',
    'text/javascript',
  ]);
  const TEXT = new Set(['text/csv', 'text/markdown', 'application/json', 'text/plain', 'text/css', 'text/javascript']);

  const rid = () => {
    let s = '';
    for (let i = 0; i < 32; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)];
    return s;
  };

  const uploads: string[] = [];
  (window as unknown as { __uploads: string[] }).__uploads = uploads;

  const assets = {
    async upload(blob: Blob, options?: { type?: string }) {
      if (!(blob instanceof Blob) || blob.size === 0) throw { code: 'invalid_request', message: 'empty or not a blob' };
      const type = options?.type ?? blob.type;
      if (!OK.has(type)) throw { code: 'unsupported_type', message: 'type not accepted: ' + type };
      if (blob.size > 20 * 1024 * 1024) throw { code: 'too_large', message: 'over 20 MiB' };
      if (TEXT.has(type)) {
        try {
          new TextDecoder('utf-8', { fatal: true }).decode(await blob.arrayBuffer());
        } catch {
          throw { code: 'invalid_request', message: 'text is not valid UTF-8' };
        }
      } else if (type !== 'image/svg+xml') {
        const head = new TextDecoder().decode(await blob.slice(0, 64).arrayBuffer()).trimStart();
        if (head.startsWith('<')) throw { code: 'unsupported_type', message: 'markup under a binary type' };
      }
      const id = rid();
      const res = await fetch('/_blob/' + id, { method: 'PUT', headers: { 'content-type': type }, body: blob });
      if (!res.ok) throw { code: 'store_unavailable', message: 'mock store failed' };
      uploads.push(id);
      return { id, url: '/_blob/' + id, sizeBytes: blob.size, contentType: type };
    },
    async list() {
      return { assets: [], usage: { files: uploads.length, bytes: 0, maxFiles: 1000, maxBytes: 1e9 } };
    },
    async delete(ref: string) {
      const id = ref.replace('/_blob/', '');
      const res = await fetch('/_blob/' + id, { method: 'DELETE' });
      return { deleted: res.ok };
    },
  };

  const map: Record<string, unknown> = {
    db,
    user,
    assets: canWrite && q.get('noassets') !== '1' ? assets : null,
  };
  const memo: Record<string, Promise<unknown>> = {};
  (window as unknown as { claude: unknown }).claude = {
    use(name: string) {
      if (!memo[name]) {
        memo[name] = new Promise((resolve) => {
          setTimeout(() => resolve(hang ? null : (map[name] ?? null)), hang ? 10000 : 30);
        });
      }
      return memo[name];
    },
  };
}
