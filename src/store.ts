// 앱 상태와 실시간 구독. 화면은 useApp(selector)로 읽고, 변경은 actions.ts의 함수로 한다.

import { useSyncExternalStore } from 'react';
import { initPlatform, localPlatform, lsGet, lsJson, lsSet, type Platform } from './platform';
import { addDays, dayOf } from './time';
import { isActiveMember, isEnded } from './logic';
import { blobPrune } from './media';
import {
  DEFAULT_SETTINGS,
  type CheckIn,
  type Material,
  type Msg,
  type PendingSession,
  type Poke,
  type Presence,
  type Profile,
  type Settings,
  type Study,
  type Uid,
} from './types';

export interface MsgRow extends Msg {
  id: string;
}

export interface AppState {
  boot: 'loading' | 'ready';
  mode: 'cloud' | 'local';
  uid: Uid;
  hasAccountId: boolean;
  host: 'claude' | 'firebase' | 'device';
  hasAssets: boolean;
  readOnly: boolean;
  slow: boolean;
  revoked: boolean;
  today: string;
  profiles: Record<Uid, Profile>;
  profilesLoaded: boolean;
  studies: Record<string, Study>;
  studiesLoaded: boolean;
  recent: Record<string, CheckIn>;
  older: Record<string, CheckIn>;
  checkins: Record<string, CheckIn>;
  checkinsLoaded: boolean;
  windowStart: string;
  loadedSince: string;
  mineLoaded: boolean;
  presence: Record<Uid, Presence>;
  pokes: Record<string, Poke>;
  messages: Record<string, MsgRow[]>;
  settings: Settings;
  settingsLoaded: boolean;
  materials: Record<string, Material>;
  materialsLoaded: boolean;
  session: Presence | null;
  pending: PendingSession | null;
  thumbs: Record<string, string[]>;
}

const today0 = dayOf(Date.now());

const initial: AppState = {
  boot: 'loading',
  mode: 'local',
  uid: '',
  hasAccountId: false,
  host: 'device',
  hasAssets: false,
  readOnly: false,
  slow: false,
  revoked: false,
  today: today0,
  profiles: {},
  profilesLoaded: false,
  studies: {},
  studiesLoaded: false,
  recent: {},
  older: {},
  checkins: {},
  checkinsLoaded: false,
  windowStart: addDays(today0, -35),
  loadedSince: addDays(today0, -35),
  mineLoaded: false,
  presence: {},
  pokes: {},
  messages: {},
  settings: DEFAULT_SETTINGS,
  settingsLoaded: false,
  materials: {},
  materialsLoaded: false,
  session: null,
  pending: null,
  thumbs: {},
};

let state: AppState = initial;
const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  for (const l of [...listeners]) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useApp<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state));
}

// ---- 실시간 이벤트(팝업 알림용) ----

export type AppEvent =
  | { type: 'msg'; sid: string; row: MsgRow }
  | { type: 'checkin'; id: string; c: CheckIn }
  | { type: 'poke'; poke: Poke }
  | { type: 'react'; cid: string; from: Uid; e: string }
  | { type: 'comment'; cid: string; from: Uid; t: string };

const eventListeners = new Set<(e: AppEvent) => void>();
export function onEvent(fn: (e: AppEvent) => void): () => void {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}
function emit(e: AppEvent) {
  for (const l of [...eventListeners]) l(e);
}

// ---- 플랫폼 ----

let plat: Platform | null = null;
export function P(): Platform {
  if (!plat) throw new Error('platform not ready');
  return plat;
}

let unsubs: Unsubscribe[] = [];
const chatSubs = new Map<string, Unsubscribe>();
let slowTimer: ReturnType<typeof setTimeout> | null = null;
let tick: ReturnType<typeof setInterval> | null = null;
let copiesPruned = false;

const FRESH = 20000;

function sessionKey() {
  return 'sw.session.' + P().uid;
}
function pendingKey() {
  return 'sw.pending.' + P().uid;
}

export function saveSessionLocal(s: Presence | null) {
  lsSet(sessionKey(), s && s.mode ? JSON.stringify(s) : null);
}
export function savePendingLocal(p: PendingSession | null) {
  lsSet(pendingKey(), p ? JSON.stringify(p) : null);
}

/**
 * 구독을 열어 두고, 플랫폼이 구독을 끝내면(일시적인 오류) 간격을 늘려 가며 다시 연다.
 * 몇 시간씩 켜 두는 화면(집중 모드, 학습장)에서 채팅과 인증 소식이 조용히 멈추지 않게 한다.
 */
function keep(what: string, open: (onErr: (e: DbError) => void) => Unsubscribe): Unsubscribe {
  let cur: Unsubscribe | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let tries = 0;
  let openedAt = 0;
  const openNow = () => {
    timer = null;
    if (closed) return;
    openedAt = Date.now();
    cur = open((e) => {
      cur = null;
      if (closed) return;
      const code = e && e.code;
      if (code === 'revoked') {
        setState({ revoked: true });
        return;
      }
      if (code === 'not_granted' || code === 'capability_disabled' || code === 'capability_removed') {
        // 저장소를 쓸 수 없는 보기: 이 기기에만 저장하는 체험 모드로 바꾼다
        if (what === 'profiles' && P().mode === 'cloud') restart(localPlatform());
        return;
      }
      console.warn('[sw] subscription ended:', what, code, e && e.message);
      // 요청 자체가 잘못된 경우는 다시 열어도 같은 결과다
      if (code === 'invalid_argument' || code === 'transform_error') return;
      if (Date.now() - openedAt > 60000) tries = 0;
      const wait = Math.min(60000, 3000 * 2 ** tries) + Math.random() * 1000;
      tries++;
      timer = setTimeout(openNow, wait);
    });
  };
  openNow();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    timer = null;
    if (cur) cur();
    cur = null;
  };
}

export function ensureChatSub(sid: string) {
  if (chatSubs.has(sid) || !plat) return;
  const db = plat.db;
  const uid = plat.uid;
  const unsub = keep('messages', (err) => {
    let first = true;
    return db
      .collection(`studies/${sid}/messages`)
      .orderBy('at', 'desc')
      .limit(150)
      .onSnapshot((snap) => {
        const rows: MsgRow[] = [];
        for (let i = snap.docs.length - 1; i >= 0; i--) {
          const d = snap.docs[i];
          rows.push({ ...(d.data() as unknown as Msg), id: d.id });
        }
        if (!first) {
          const now = Date.now();
          for (const ch of snap.docChanges()) {
            if (ch.type !== 'added') continue;
            const m = ch.doc.data() as unknown as Msg;
            if (m && m.u !== uid && now - m.at < FRESH) emit({ type: 'msg', sid, row: { ...m, id: ch.doc.id } });
          }
        }
        first = false;
        setState({ messages: { ...state.messages, [sid]: rows } });
      }, err);
  });
  chatSubs.set(sid, unsub);
}

function syncChatSubs() {
  if (!plat) return;
  const uid = plat.uid;
  const want = new Set<string>();
  for (const sid of Object.keys(state.studies)) {
    const st = state.studies[sid];
    if (isActiveMember(st, uid) && !isEnded(st, state.today)) want.add(sid);
  }
  for (const sid of want) ensureChatSub(sid);
  for (const [sid, unsub] of [...chatSubs]) {
    const st = state.studies[sid];
    if (!st || !isActiveMember(st, uid)) {
      unsub();
      chatSubs.delete(sid);
      const { [sid]: _gone, ...rest } = state.messages;
      setState({ messages: rest });
    }
  }
}

function mergeCheckins() {
  setState({ checkins: { ...state.older, ...state.recent } });
}

function start() {
  const p = P();
  const now = Date.now();
  const today = dayOf(now);
  const windowStart = addDays(today, -35);
  let session = lsJson<Presence>(sessionKey());
  if (session && !session.mode) session = null;
  let pending = lsJson<PendingSession>(pendingKey());
  if (pending && dayOf(pending.ended) !== today) {
    pending = null;
    savePendingLocal(null);
  }
  setState({
    ...initial,
    mode: p.mode,
    uid: p.uid,
    hasAccountId: p.hasAccountId,
    host: p.host,
    hasAssets: !!p.assets,
    readOnly: p.canWrite === false,
    today,
    windowStart,
    loadedSince: windowStart,
    session,
    pending,
  });

  slowTimer = setTimeout(() => {
    if (!state.profilesLoaded) setState({ slow: true });
  }, 10000);

  unsubs.push(
    keep('profiles', (err) =>
      p.db.collection('profiles').onSnapshot((snap) => {
        const m: Record<Uid, Profile> = {};
        for (const d of snap.docs) m[d.id] = d.data() as unknown as Profile;
        const confirmed = !snap.metadata.fromCache;
        const haveMe = !!m[p.uid] && !m[p.uid].deleted;
        if (confirmed || haveMe) setState({ profiles: m, profilesLoaded: true, slow: false, boot: 'ready' });
        else setState({ profiles: m });
      }, err),
    ),
  );

  // 목록 구독의 확인이 늦어져도 시작할 수 있게, 내 프로필 문서 하나는 따로 읽어 본다
  p.db
    .doc('profiles/' + p.uid)
    .get()
    .then((d) => {
      if (plat !== p || state.boot === 'ready') return;
      const mine = d.exists ? (d.data() as unknown as Profile) : null;
      setState({ profiles: mine ? { ...state.profiles, [p.uid]: mine } : state.profiles, profilesLoaded: true, slow: false, boot: 'ready' });
    })
    .catch(() => undefined);

  unsubs.push(
    keep('studies', (err) =>
      p.db.collection('studies').onSnapshot((snap) => {
        const m: Record<string, Study> = {};
        for (const d of snap.docs) m[d.id] = d.data() as unknown as Study;
        setState({ studies: m, studiesLoaded: true });
        syncChatSubs();
      }, err),
    ),
  );

  unsubs.push(
    keep('checkins', (err) => {
      let first = true;
      return p.db
        .collection('checkins')
        .where('day', '>=', windowStart)
        .onSnapshot((snap) => {
          const m: Record<string, CheckIn> = {};
          for (const d of snap.docs) m[d.id] = d.data() as unknown as CheckIn;
          if (!first) {
            const t = Date.now();
            for (const ch of snap.docChanges()) {
              const c = ch.doc.data() as unknown as CheckIn;
              if (!c) continue;
              if (ch.type === 'added' && c.uid !== p.uid && t - c.at < FRESH) emit({ type: 'checkin', id: ch.doc.id, c });
              if (ch.type === 'modified' && c.uid === p.uid) {
                const before = state.recent[ch.doc.id];
                for (const u of Object.keys(c.r ?? {})) {
                  const r = c.r![u];
                  if (u !== p.uid && r && t - r.at < FRESH && before?.r?.[u]?.at !== r.at) emit({ type: 'react', cid: ch.doc.id, from: u, e: r.e });
                }
                for (const k of Object.keys(c.c ?? {})) {
                  const cm = c.c![k];
                  if (cm && cm.u !== p.uid && t - cm.at < FRESH && !before?.c?.[k]) emit({ type: 'comment', cid: ch.doc.id, from: cm.u, t: cm.t });
                }
              }
            }
          }
          first = false;
          state = { ...state, recent: m, checkinsLoaded: true };
          mergeCheckins();
        }, err);
    }),
  );

  unsubs.push(
    keep('presence', (err) =>
      p.db.collection('presence').onSnapshot((snap) => {
        const m: Record<Uid, Presence> = {};
        for (const d of snap.docs) m[d.id] = d.data() as unknown as Presence;
        const remote = m[p.uid];
        const mine = state.session;
        // 다른 기기에서 세션을 바꿨으면 더 최근 것을 따른다
        if (remote && (!mine || remote.at > mine.at)) {
          const next = remote.mode ? remote : null;
          saveSessionLocal(next);
          setState({ presence: m, session: next });
        } else setState({ presence: m });
      }, err),
    ),
  );

  unsubs.push(
    keep('pokes', (err) => {
      let first = true;
      return p.db
        .collection('pokes')
        .where('to', '==', p.uid)
        .onSnapshot((snap) => {
          const m: Record<string, Poke> = {};
          for (const d of snap.docs) m[d.id] = d.data() as unknown as Poke;
          if (!first) {
            const t = Date.now();
            for (const ch of snap.docChanges()) {
              const pk = ch.doc.data() as unknown as Poke;
              if (ch.type === 'added' && pk && t - pk.at < FRESH) emit({ type: 'poke', poke: pk });
            }
          }
          first = false;
          setState({ pokes: m });
        }, err);
    }),
  );

  unsubs.push(
    keep('settings', (err) =>
      p.pdb.doc(p.ppath + '/settings').onSnapshot((snap) => {
        const confirmed = !snap.metadata.fromCache;
        if (state.settingsLoaded && (settingsDirty || settingsSaving)) return;
        // 저장소가 아직 답하지 않은 빈 사본은 "설정 없음"이 아니다. 확인될 때까지 기다린다.
        if (!state.settingsLoaded && !confirmed && !snap.exists) return;
        const d = (snap.exists ? snap.data() : null) as Partial<Settings> | null;
        let s: Settings = {
          ...DEFAULT_SETTINGS,
          ...(d ?? {}),
          notif: { ...DEFAULT_SETTINGS.notif, ...(d?.notif ?? {}) },
          read: { ...(d?.read ?? {}) },
          blocks: { ...(d?.blocks ?? {}) },
        };
        if (state.settingsLoaded) {
          setState({ settings: s });
          return;
        }
        // 저장소가 확인해 주기 전에 한 변경(읽음 표시 등)은 받은 설정 위에 다시 얹는다.
        // 지난 방문 때의 사본은 화면에만 쓰고, 저장은 저장소가 답한 뒤에 한다(다른 기기에서 바꾼 설정을 덮어쓰지 않게).
        for (const fn of earlyPatches) s = fn(s);
        if (!confirmed) {
          setState({ settings: s });
          return;
        }
        const hadEarly = earlyPatches.length > 0;
        earlyPatches = [];
        setState({ settings: s, settingsLoaded: true });
        if (hadEarly && settingsReadyHook) settingsReadyHook();
      }, err),
    ),
  );

  unsubs.push(
    keep('materials', (err) =>
      p.pdb
        .doc(p.ppath + '/lib')
        .collection('materials')
        .onSnapshot((snap) => {
          const m: Record<string, Material> = {};
          for (const d of snap.docs) m[d.id] = d.data() as unknown as Material;
          setState({ materials: m, materialsLoaded: true });
          // 지워진 자료의 기기 사본을 한 번 정리한다(사본만 지운다. 기기에만 있는 원본은 건드리지 않는다)
          if (!copiesPruned && !snap.metadata.fromCache) {
            copiesPruned = true;
            blobPrune('matc:', (id) => !!m[id]?.asset).catch(() => undefined);
          }
        }, err),
    ),
  );

  tick = setInterval(() => {
    const t = dayOf(Date.now());
    if (t !== state.today) {
      const patch: Partial<AppState> = { today: t };
      if (state.pending && dayOf(state.pending.ended) !== t) {
        patch.pending = null;
        savePendingLocal(null);
      }
      setState(patch);
      syncChatSubs();
    }
  }, 30000);
}

function stop() {
  earlyPatches = [];
  for (const u of unsubs) u();
  unsubs = [];
  for (const u of chatSubs.values()) u();
  chatSubs.clear();
  if (slowTimer) clearTimeout(slowTimer);
  if (tick) clearInterval(tick);
  slowTimer = null;
  tick = null;
}

let bootSeq = 0;

export function restart(next: Platform) {
  bootSeq++; // 아직 끝나지 않은 boot()가 있으면 그 결과는 버린다
  stop();
  plat = next;
  settingsDirty = false;
  settingsSaving = false;
  start();
}

export async function boot() {
  const seq = ++bootSeq;
  // 저장소 연결이 오래 걸리면 기다리는 동안 체험 모드 버튼을 보여 준다
  const hint = setTimeout(() => {
    if (seq === bootSeq && state.boot !== 'ready') setState({ slow: true });
  }, 6000);
  try {
    const p = await initPlatform();
    if (seq !== bootSeq) return;
    stop();
    plat = p;
    settingsDirty = false;
    settingsSaving = false;
    start();
  } finally {
    clearTimeout(hint);
  }
}

/** 보기 전용으로 열린 사람이 이 기기에서만 써 보기 */
export function switchToLocal() {
  lsSet('sw.forceLocal', '1');
  restart(localPlatform());
}

export function isForcedLocal(): boolean {
  return lsGet('sw.forceLocal') === '1';
}

/** 체험 모드를 끝내고 공유 저장소로 다시 연결 */
export async function leaveLocal() {
  lsSet('sw.forceLocal', null);
  stop();
  setState({ ...initial });
  await boot();
}

// ---- 설정 저장 상태(스냅샷이 저장 전 변경을 덮어쓰지 않도록) ----

export let settingsDirty = false;
export let settingsSaving = false;
export function markSettings(dirty: boolean, saving: boolean) {
  settingsDirty = dirty;
  settingsSaving = saving;
}

// 저장된 설정을 받기 전에 들어온 변경. 기본값에 얹어 저장하면 저장돼 있던 설정(차단 목록, 알림 설정)을 덮어쓰게 되므로
// 모아 두었다가 설정을 받은 뒤 그 위에 적용한다.
let earlyPatches: Array<(s: Settings) => Settings> = [];
let settingsReadyHook: (() => void) | null = null;
export function queueEarlyPatch(fn: (s: Settings) => Settings) {
  earlyPatches.push(fn);
}
/** 모아 둔 변경을 적용한 뒤 저장을 시작하게 할 함수(actions가 등록한다) */
export function onEarlyPatchesApplied(fn: () => void) {
  settingsReadyHook = fn;
}

// ---- 지난 인증 불러오기 ----

export function putOlder(rows: Record<string, CheckIn>, patch: Partial<AppState> = {}) {
  state = { ...state, older: { ...state.older, ...rows }, ...patch };
  mergeCheckins();
}

export function dropCheckinLocal(cid: string) {
  const { [cid]: _a, ...older } = state.older;
  const { [cid]: _b, ...thumbs } = state.thumbs;
  state = { ...state, older, thumbs };
  mergeCheckins();
}
