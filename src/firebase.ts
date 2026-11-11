// GitHub Pages처럼 claude.ai 밖에서 열 때 쓰는 공유 저장소.
// Firebase Firestore를 platform의 `db`와 같은 모양(DB 타입)으로 감싸고,
// 사용자는 이메일·비밀번호 계정으로 구분한다.

import { initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  collection as fsCollection,
  connectFirestoreEmulator,
  deleteDoc,
  FieldPath,
  doc as fsDoc,
  getDoc,
  getDocs,
  initializeFirestore,
  limit as fsLimit,
  onSnapshot as fsOnSnapshot,
  orderBy as fsOrderBy,
  query as fsQuery,
  setDoc,
  updateDoc,
  where as fsWhere,
  type DocumentData,
  type DocumentSnapshot as FsDocSnap,
  type Firestore,
  type Query as FsQuery,
  type QueryConstraint,
  type QuerySnapshot as FsQuerySnap,
  type WhereFilterOp,
} from 'firebase/firestore';

function toDbError(e: unknown): DbError {
  const code = (e as { code?: string } | null)?.code ?? '';
  const message = (e as { message?: string } | null)?.message ?? String(e);
  switch (code) {
    case 'permission-denied':
    case 'not-found':
    case 'invalid-argument':
    case 'failed-precondition':
    case 'out-of-range':
    case 'already-exists':
      return { code: 'invalid_argument', message };
    case 'resource-exhausted':
      return { code: 'resource_exhausted', message };
    case 'unauthenticated':
      return { code: 'revoked', message };
    default:
      return { code: 'unavailable', message };
  }
}

function wrapDoc(s: FsDocSnap<DocumentData>): DocumentSnapshot {
  const exists = s.exists();
  const body = exists ? (s.data() as Record<string, unknown>) : undefined;
  return {
    id: s.id,
    exists,
    data: () => body,
    metadata: { fromCache: s.metadata.fromCache, hasPendingWrites: s.metadata.hasPendingWrites },
  } as DocumentSnapshot;
}

function wrapQuerySnap(s: FsQuerySnap<DocumentData>): QuerySnapshot {
  const docs = s.docs.map(wrapDoc);
  return {
    docs,
    size: docs.length,
    empty: docs.length === 0,
    docChanges: () => s.docChanges().map((c) => ({ type: c.type, doc: wrapDoc(c.doc), oldIndex: c.oldIndex, newIndex: c.newIndex })),
    metadata: { fromCache: s.metadata.fromCache, hasPendingWrites: s.metadata.hasPendingWrites },
  } as QuerySnapshot;
}

const OPS: Record<string, WhereFilterOp> = {
  '==': '==',
  '!=': '!=',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
  in: 'in',
  'not-in': 'not-in',
  'array-contains': 'array-contains',
  'array-contains-any': 'array-contains-any',
  eq: '==',
  ne: '!=',
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
};

function makeQuery(fs: Firestore, path: string, cons: QueryConstraint[]): Query {
  const q = (): FsQuery<DocumentData> => fsQuery(fsCollection(fs, path), ...cons);
  return {
    where: (field: string, op: string, value: unknown) => makeQuery(fs, path, [...cons, fsWhere(field, OPS[op] ?? (op as WhereFilterOp), value)]),
    orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') => makeQuery(fs, path, [...cons, fsOrderBy(field, dir)]),
    limit: (n: number) => makeQuery(fs, path, [...cons, fsLimit(n)]),
    get: async () => {
      try {
        return wrapQuerySnap(await getDocs(q()));
      } catch (e) {
        throw toDbError(e);
      }
    },
    onSnapshot: (next: (s: QuerySnapshot) => void, error?: (e: DbError) => void) =>
      fsOnSnapshot(
        q(),
        { includeMetadataChanges: true },
        (s) => next(wrapQuerySnap(s)),
        (e) => error?.(toDbError(e)),
      ),
  } as unknown as Query;
}

function makeDoc(fs: Firestore, path: string): DocumentReference {
  const ref = () => fsDoc(fs, path);
  const segs = path.split('/');
  return {
    id: segs[segs.length - 1],
    path,
    get: async () => {
      try {
        return wrapDoc(await getDoc(ref()));
      } catch (e) {
        throw toDbError(e);
      }
    },
    set: async (data: Record<string, unknown>) => {
      try {
        await setDoc(ref(), data);
      } catch (e) {
        throw toDbError(e);
      }
    },
    update: async (data: Record<string, unknown>) => {
      try {
        // DB 계약의 update는 깊은 병합이라, 중첩된 객체를 필드 경로 하나하나로 풀어서 넘긴다.
        const pairs: unknown[] = [];
        flatten(data, [], pairs);
        if (!pairs.length) return;
        const [first, firstVal, ...rest] = pairs;
        await updateDoc(ref(), first as FieldPath, firstVal, ...rest);
      } catch (e) {
        throw toDbError(e);
      }
    },
    delete: async () => {
      try {
        await deleteDoc(ref());
      } catch (e) {
        throw toDbError(e);
      }
    },
    onSnapshot: (next: (s: DocumentSnapshot) => void, error?: (e: DbError) => void) =>
      fsOnSnapshot(
        ref(),
        { includeMetadataChanges: true },
        (s) => next(wrapDoc(s)),
        (e) => error?.(toDbError(e)),
      ),
    collection: (sub: string) => makeCollection(fs, path + '/' + sub),
  } as unknown as DocumentReference;
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

function flatten(obj: Record<string, unknown>, prefix: string[], out: unknown[]) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined) continue;
    const path = [...prefix, k];
    if (isPlain(v) && Object.keys(v).length) flatten(v, path, out);
    else out.push(new FieldPath(...path), v);
  }
}

function autoId(): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const buf = new Uint8Array(20);
  crypto.getRandomValues(buf);
  let s = '';
  for (const b of buf) s += abc[b % abc.length];
  return s;
}

function makeCollection(fs: Firestore, path: string): CollectionReference {
  const base = makeQuery(fs, path, []);
  return {
    ...base,
    path,
    doc: (id?: string) => makeDoc(fs, path + '/' + (id ?? autoId())),
    add: async (data: Record<string, unknown>) => {
      const d = makeDoc(fs, path + '/' + autoId());
      await d.set(data);
      return d;
    },
  } as unknown as CollectionReference;
}

export interface FirebaseSession {
  db: DB;
  uid: string;
}

type Cfg = FirebaseOptions & { emulator?: string };
let inst: { fs: Firestore; auth: Auth } | null = null;

function fb(config: Cfg) {
  if (inst) return inst;
  const app = initializeApp(config);
  const fs = initializeFirestore(app, { ignoreUndefinedProperties: true });
  const auth = getAuth(app);
  if (config.emulator) {
    // 테스트용: 로컬 에뮬레이터(Firestore 8080, Auth 9099)에 붙는다
    connectFirestoreEmulator(fs, config.emulator, 8080);
    connectAuthEmulator(auth, `http://${config.emulator}:9099`, { disableWarnings: true });
  }
  inst = { fs, auth };
  return inst;
}

/** 이 브라우저에 로그인돼 있는 계정. 없으면 null */
export function currentUser(config: Cfg): Promise<User | null> {
  const { auth } = fb(config);
  return new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (u) => {
      off();
      resolve(u);
    });
  });
}

function authMessage(e: unknown): string {
  const code = (e as { code?: string } | null)?.code ?? '';
  switch (code) {
    case 'auth/invalid-email':
      return '이메일 주소를 다시 확인해 주세요.';
    case 'auth/missing-password':
      return '비밀번호를 적어 주세요.';
    case 'auth/weak-password':
      return '비밀번호는 6자 이상으로 만들어 주세요.';
    case 'auth/email-already-in-use':
      return '이미 가입된 이메일이에요. 로그인해 주세요.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-login-credentials':
      return '이메일 또는 비밀번호가 맞지 않아요.';
    case 'auth/too-many-requests':
      return '시도가 너무 많아요. 잠시 뒤에 다시 해 주세요.';
    case 'auth/network-request-failed':
      return '인터넷 연결을 확인해 주세요.';
    case 'auth/operation-not-allowed':
      return '아직 이메일 가입이 꺼져 있어요. 관리자에게 Firebase에서 이메일/비밀번호 로그인을 켜 달라고 해 주세요.';
    default:
      return '잠시 문제가 생겼어요. 다시 시도해 주세요.' + (code ? ` (${code})` : '');
  }
}

async function wrapAuth<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw new Error(authMessage(e));
  }
}

export const signUp = (config: Cfg, email: string, password: string) => wrapAuth(() => createUserWithEmailAndPassword(fb(config).auth, email.trim(), password));
export const signIn = (config: Cfg, email: string, password: string) => wrapAuth(() => signInWithEmailAndPassword(fb(config).auth, email.trim(), password));
export const resetPassword = (config: Cfg, email: string) => wrapAuth(() => sendPasswordResetEmail(fb(config).auth, email.trim()));
export const logOut = (config: Cfg) => signOut(fb(config).auth);
/** 탈퇴: 계정을 지운다. 로그인한 지 오래돼 거절되면 로그아웃만 한다. */
export async function deleteAccount(config: Cfg) {
  const { auth } = fb(config);
  if (auth.currentUser) await deleteUser(auth.currentUser).catch(() => undefined);
  await signOut(auth).catch(() => undefined);
}

/** 로그인한 계정으로 DB를 돌려준다. 로그인하지 않았거나 연결에 실패하면 null */
export async function connectFirebase(config: Cfg): Promise<FirebaseSession | null> {
  try {
    const u = await currentUser(config);
    if (!u) return null;
    const { fs } = fb(config);
    const db = {
      doc: (path: string) => makeDoc(fs, path),
      collection: (path: string) => makeCollection(fs, path),
    } as unknown as DB;
    return { db, uid: u.uid };
  } catch (e) {
    console.warn('Firebase 연결 실패', e);
    return null;
  }
}
