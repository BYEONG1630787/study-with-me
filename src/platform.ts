// 실행 환경 연결. claude.ai 안에서 열리면 공유 저장소(db)를 쓰고, 아니면 이 기기에만 저장한다.

import { createLocalDb } from './localdb';
import { makeId } from './logic';
import { FIREBASE_CONFIG } from './env';

export interface Platform {
  mode: 'cloud' | 'local';
  /** 공유 저장소를 대 주는 곳 */
  host: 'claude' | 'firebase' | 'device';
  /** 모두가 함께 보는 데이터 */
  db: DB;
  /** 나만 보는 데이터(설정, 학습 자료 목록) */
  pdb: DB;
  /** 내 개인 영역 경로: data/users/<id> */
  ppath: string;
  uid: string;
  hasAccountId: boolean;
  assets: Claude.Assets | null;
  /** 플랫폼이 알려 준 쓰기 가능 여부. null이면 모름(써 보고 판단) */
  canWrite: boolean | null;
  deviceId: string;
}

const mem: Record<string, string> = {};

export function lsGet(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    return v ?? mem[key] ?? null;
  } catch {
    return mem[key] ?? null;
  }
}

export function lsSet(key: string, value: string | null) {
  if (value === null) delete mem[key];
  else mem[key] = value;
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 저장소를 못 쓰면 이번 방문 동안만 기억한다 */
  }
}

export function lsJson<T>(key: string): T | null {
  const raw = lsGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function deviceId(): string {
  let id = lsGet('sw.device');
  if (!id) {
    id = makeId(18);
    lsSet('sw.device', id);
  }
  return id;
}

export function localPlatform(): Platform {
  const dev = deviceId();
  const uid = 'local-' + dev;
  const ldb = createLocalDb({ name: 'sw-local', viewerId: uid });
  return { mode: 'local', db: ldb, pdb: ldb, ppath: 'data/users/' + uid, uid, hasAccountId: false, assets: null, canWrite: true, deviceId: dev, host: 'device' };
}

export async function initPlatform(): Promise<Platform> {
  const dev = deviceId();
  const c = (window as unknown as { claude?: Claude }).claude;
  let db: DB | null = null;
  let user: ClaudeCapabilityMap['user'] | null = null;
  let assets: Claude.Assets | null = null;
  if (c && typeof c.use === 'function' && lsGet('sw.forceLocal') !== '1') {
    try {
      [db, user, assets] = await Promise.all([c.use('db'), c.use('user'), c.use('assets')]);
    } catch {
      db = null;
    }
  }
  if (!db && FIREBASE_CONFIG && lsGet('sw.forceLocal') !== '1') {
    const { connectFirebase } = await import('./firebase');
    const fb = await connectFirebase(FIREBASE_CONFIG);
    if (fb) return { mode: 'cloud', host: 'firebase', db: fb.db, pdb: fb.db, ppath: 'data/users/' + fb.uid, uid: fb.uid, hasAccountId: true, assets: null, canWrite: true, deviceId: dev };
  }
  if (!db) return localPlatform();

  let pid: string | null = null;
  let can: boolean | null = null;
  if (user) {
    try {
      pid = await user.id();
      can = await user.can('data.write');
    } catch {
      /* user 읽기는 거절되지 않지만, 혹시 모를 구버전 대비 */
    }
  }
  const uid = pid ?? 'd_' + dev;
  const pdb = pid ? db : createLocalDb({ name: 'sw-private', viewerId: uid });
  return { mode: 'cloud', db, pdb, ppath: 'data/users/' + uid, uid, hasAccountId: !!pid, assets, canWrite: can, deviceId: dev, host: 'claude' };
}

/** 자산 저장소에 있는 파일의 주소 */
export function assetUrl(id: string): string {
  return '/_blob/' + id;
}
