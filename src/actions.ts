// 사용자가 하는 모든 변경. 실패하면 한국어 안내가 담긴 AppError를 던진다.

import { P, dropCheckinLocal, getState, markSettings, onEarlyPatchesApplied, putOlder, queueEarlyPatch, saveSessionLocal, savePendingLocal, setState, settingsDirty } from './store';
import { activeMemberIds, hostOf, isActiveMember, isEnded, makeCode, makeId, makeTimeId, normalizeCode, notStarted, pendingRule, ruleForWeek } from './logic';
import { addDays, dayOf, isValidDay, weekStart } from './time';
import { blobDel, blobGet, blobPut, inlineData, readText, type Prepared } from './media';
import { assetUrl } from './platform';
import { MAX_STUDIES, type CheckIn, type Material, type MaterialKind, type PendingSession, type PhotoRef, type Presence, type Profile, type RuleRev, type Settings, type Study, type Uid } from './types';

export class AppError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export function errText(e: unknown): string {
  if (e instanceof AppError) return e.message;
  return '문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
}

let everWrote = false;
const chains = new Map<string, Promise<unknown>>();

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/**
 * 저장소 오류를 안내 문장으로 바꾼다.
 * 거절된 쓰기를 "권한 없음"으로 보는 것은 플랫폼이 쓰기 가능 여부를 알려 주지 않았고(canWrite === null)
 * 이번 방문에서 아직 한 번도 쓰지 못한 경우뿐이다. update는 대상 문서가 지워졌을 때도 같은 코드로 거절되므로
 * 문서가 남아 있는 것을 확인한 경우에만 권한 문제로 본다.
 */
function toAppError(e: unknown, kind: 'set' | 'update' | 'delete' = 'set', exists: boolean | null = null): AppError {
  if (e instanceof AppError) return e;
  const code = (e as { code?: string } | null)?.code;
  switch (code) {
    case 'invalid_argument':
    case 'transform_error':
      if (!everWrote && P().canWrite === null && (kind !== 'update' || exists === true)) {
        setState({ readOnly: true });
        return new AppError('이 페이지에 기록할 권한이 없어요. 페이지 주인에게 편집자로 초대해 달라고 요청해 주세요.', 'readonly');
      }
      if (kind === 'update' && exists === false) return new AppError('이미 지워진 항목이에요.', 'gone');
      return new AppError('저장하지 못했어요. 입력한 내용을 확인해 주세요.', code);
    case 'quota_exceeded':
      return new AppError('저장 공간이 가득 찼어요. 오래된 인증이나 자료를 지운 뒤 다시 시도해 주세요.', code);
    case 'resource_exhausted':
      return new AppError('요청이 몰렸어요. 잠시 후 다시 시도해 주세요.', code);
    case 'revoked':
    case 'not_granted':
    case 'capability_disabled':
    case 'capability_removed':
      return new AppError('접근 권한이 바뀌었어요. 페이지를 새로 열어 주세요.', code);
    default:
      return new AppError('연결이 불안정해요. 잠시 후 다시 시도해 주세요.', code ?? 'unavailable');
  }
}

/** 같은 문서에는 한 번에 한 건씩만 쓴다. 일시적 오류는 한 번 더 시도한다. */
function wr(ref: DocumentReference, kind: 'set' | 'update' | 'delete', data?: Record<string, unknown>): Promise<void> {
  const run = async () => {
    const op = () => (kind === 'set' ? ref.set(data!) : kind === 'update' ? ref.update(data!) : ref.delete());
    try {
      try {
        await op();
      } catch (e) {
        if ((e as { code?: string } | null)?.code !== 'unavailable') throw e;
        await sleep(250 + Math.random() * 500);
        await op();
      }
      everWrote = true;
    } catch (e) {
      let exists: boolean | null = null;
      const code = (e as { code?: string } | null)?.code;
      if (kind === 'update' && (code === 'invalid_argument' || code === 'transform_error')) {
        exists = await ref.get().then(
          (d) => d.exists,
          () => null,
        );
      }
      throw toAppError(e, kind, exists);
    }
  };
  const prev = chains.get(ref.path) ?? Promise.resolve();
  const next = prev.then(run, run);
  chains.set(ref.path, next);
  next.then(
    () => chains.get(ref.path) === next && chains.delete(ref.path),
    () => chains.get(ref.path) === next && chains.delete(ref.path),
  );
  return next;
}

function me(): Uid {
  return P().uid;
}

function guardWrite() {
  if (getState().readOnly) throw new AppError('보기 전용으로 열려 있어 기록할 수 없어요.', 'readonly');
}

// ---------------------------------------------------------------- 프로필

export async function saveProfile(input: { nick: string; color: number; photo: string | null }): Promise<void> {
  guardWrite();
  const nick = input.nick.trim();
  if (nick.length < 2 || nick.length > 12) throw new AppError('닉네임은 2~12자로 적어 주세요.');
  const s = getState();
  const prev = s.profiles[me()];
  const now = Date.now();
  const doc: Profile = {
    nick,
    color: input.color,
    photo: input.photo,
    createdAt: prev && !prev.deleted ? prev.createdAt : now,
    agreedAt: prev && !prev.deleted ? prev.agreedAt : now,
  };
  await wr(P().db.doc('profiles/' + me()), 'set', doc as unknown as Record<string, unknown>);
}

/** 회원 탈퇴: 프로필을 지우고 모든 스터디에서 나간다. 올린 인증은 "탈퇴한 사용자"로 남는다. */
export async function withdraw(): Promise<void> {
  guardWrite();
  const s = getState();
  const uid = me();
  for (const sid of Object.keys(s.studies)) {
    const st = s.studies[sid];
    if (!isActiveMember(st, uid)) continue;
    await leaveStudy(sid, true);
  }
  if (s.session) await endSessionQuietly();
  setPending(null);
  const prev = s.profiles[uid];
  await wr(P().db.doc('profiles/' + uid), 'set', { nick: '', color: 0, photo: null, createdAt: prev?.createdAt ?? Date.now(), agreedAt: 0, deleted: true });
  try {
    await wr(P().db.doc('presence/' + uid), 'delete');
    await wr(P().pdb.doc(P().ppath + '/settings'), 'delete');
  } catch {
    /* 개인 설정 정리는 실패해도 탈퇴는 끝난 것으로 본다 */
  }
}

// ---------------------------------------------------------------- 스터디

export interface StudyForm {
  name: string;
  intro: string;
  start: string;
  end: string | null;
  max: number;
  weekly: number;
  dailyMin: number;
}

function validateStudy(f: StudyForm, today: string, isNew: boolean) {
  const name = f.name.trim();
  if (!name) throw new AppError('스터디 이름을 적어 주세요.');
  if (name.length > 20) throw new AppError('스터디 이름은 20자까지 쓸 수 있어요.');
  if (f.intro.trim().length > 100) throw new AppError('소개는 100자까지 쓸 수 있어요.');
  if (!isValidDay(f.start)) throw new AppError('시작일을 골라 주세요.');
  if (f.end && !isValidDay(f.end)) throw new AppError('종료일을 다시 골라 주세요.');
  if (f.end && f.end < f.start) throw new AppError('종료일은 시작일보다 빠를 수 없어요.');
  if (isNew && f.end && f.end < today) throw new AppError('종료일이 이미 지났어요.');
  if (!(f.max >= 2 && f.max <= 10)) throw new AppError('최대 인원은 2~10명으로 정해 주세요.');
  if (!(f.weekly >= 1 && f.weekly <= 7)) throw new AppError('주당 목표는 1~7회로 정해 주세요.');
  if (!(f.dailyMin >= 0 && f.dailyMin <= 720 && f.dailyMin % 30 === 0)) throw new AppError('하루 최소 공부 시간은 30분 단위로 정해 주세요.');
}

function myOpenStudyCount(): number {
  const s = getState();
  return Object.values(s.studies).filter((st) => isActiveMember(st, me()) && !isEnded(st, s.today)).length;
}

function freshCode(): string {
  const used = new Set(Object.values(getState().studies).map((s) => s.code));
  for (let i = 0; i < 50; i++) {
    const c = makeCode();
    if (!used.has(c)) return c;
  }
  return makeCode();
}

export async function createStudy(f: StudyForm): Promise<string> {
  guardWrite();
  const s = getState();
  validateStudy(f, s.today, true);
  if (myOpenStudyCount() >= MAX_STUDIES) throw new AppError(`스터디는 한 번에 ${MAX_STUDIES}개까지 참여할 수 있어요.`);
  const now = Date.now();
  const sid = makeId(12);
  const study: Study = {
    name: f.name.trim(),
    intro: f.intro.trim(),
    start: f.start,
    end: f.end || null,
    max: f.max,
    code: freshCode(),
    status: 'open',
    endedAt: null,
    // 규칙은 주 단위로 적용하므로 시작일이 든 주의 월요일부터로 적는다
    rules: [{ from: weekStart(f.start), weekly: f.weekly, dailyMin: f.dailyMin }],
    members: { [me()]: { role: 'host', state: 'active', joinedAt: now, leftAt: null, kickedCode: null } },
    fineAmount: 0,
    fineFrom: null,
    paid: {},
    createdAt: now,
    createdBy: me(),
  };
  await wr(P().db.doc('studies/' + sid), 'set', study as unknown as Record<string, unknown>);
  return sid;
}

function requireHost(sid: string): Study {
  const st = getState().studies[sid];
  if (!st) throw new AppError('스터디를 찾을 수 없어요.');
  if (hostOf(st) !== me()) throw new AppError('방장만 할 수 있어요.');
  return st;
}

export async function updateStudy(sid: string, f: StudyForm): Promise<void> {
  guardWrite();
  const s = getState();
  const st = requireHost(sid);
  if (isEnded(st, s.today)) throw new AppError('종료된 스터디는 수정할 수 없어요.');
  validateStudy({ ...f, start: st.start }, s.today, false);
  if (f.max < activeMemberIds(st).length) throw new AppError('지금 멤버 수보다 적게 정할 수 없어요.');
  const ws = weekStart(s.today);
  const cur = ruleForWeek(st, ws);
  const pend = pendingRule(st, s.today);
  const shown = pend ?? cur;
  let rules: RuleRev[] = st.rules;
  if (f.weekly !== shown.weekly || f.dailyMin !== shown.dailyMin) {
    if (notStarted(st, s.today)) {
      // 아직 시작 전이면 처음 규칙을 바로 바꾼다
      rules = [{ from: weekStart(st.start), weekly: f.weekly, dailyMin: f.dailyMin }];
    } else {
      // 이미 진행 중인 주의 달성 여부가 바뀌지 않도록 다음 주 월요일부터 적용
      const from = addDays(ws, 7);
      rules = [...st.rules.filter((r) => r.from < from), { from, weekly: f.weekly, dailyMin: f.dailyMin }];
      if (f.weekly === cur.weekly && f.dailyMin === cur.dailyMin) rules = st.rules.filter((r) => r.from < from);
    }
  }
  await wr(P().db.doc('studies/' + sid), 'update', { name: f.name.trim(), intro: f.intro.trim(), end: f.end || null, max: f.max, rules });
}

export interface JoinCheck {
  sid: string;
  study: Study;
  error: string | null;
  already: boolean;
}

/** 초대 코드로 스터디를 찾고, 참여할 수 있는지 확인한다. */
export function checkJoin(codeRaw: string): JoinCheck | null {
  const code = normalizeCode(codeRaw);
  const s = getState();
  const sid = Object.keys(s.studies).find((id) => s.studies[id].code === code);
  if (!sid) return null;
  const st = s.studies[sid];
  const mem = st.members[me()];
  let error: string | null = null;
  const already = !!mem && mem.state === 'active';
  if (already) error = null;
  else if (isEnded(st, s.today)) error = '이미 종료된 스터디예요.';
  else if (mem && mem.state === 'kicked' && mem.kickedCode === st.code) error = '방장이 내보낸 스터디예요. 다시 참여하려면 새 초대 코드가 필요해요.';
  else if (activeMemberIds(st).length >= st.max) error = `정원(${st.max}명)이 가득 찼어요.`;
  else if (myOpenStudyCount() >= MAX_STUDIES) error = `스터디는 한 번에 ${MAX_STUDIES}개까지 참여할 수 있어요. 다른 스터디에서 나간 뒤 다시 시도해 주세요.`;
  return { sid, study: st, error, already };
}

export async function joinStudy(codeRaw: string): Promise<string> {
  guardWrite();
  const chk = checkJoin(codeRaw);
  if (!chk) throw new AppError('초대 코드를 찾을 수 없어요. 방장이 코드를 다시 발급했다면 새 코드가 필요해요.');
  if (chk.already) return chk.sid;
  if (chk.error) throw new AppError(chk.error);
  await wr(P().db.doc('studies/' + chk.sid), 'update', {
    members: { [me()]: { role: 'member', state: 'active', joinedAt: Date.now(), leftAt: null, kickedCode: null } },
  });
  return chk.sid;
}

/** 나가기. 방장은 먼저 위임해야 한다. auto=true(탈퇴)면 가장 오래된 멤버에게 넘기거나 혼자면 종료한다. */
export async function leaveStudy(sid: string, auto = false): Promise<void> {
  guardWrite();
  const st = getState().studies[sid];
  if (!st || !isActiveMember(st, me())) return;
  const now = Date.now();
  const others = activeMemberIds(st).filter((u) => u !== me());
  const patch: Record<string, unknown> = { members: { [me()]: { state: 'left', leftAt: now } } };
  if (hostOf(st) === me()) {
    if (others.length === 0) {
      patch.status = 'ended';
      patch.endedAt = now;
    } else if (auto) {
      patch.members = { [me()]: { state: 'left', leftAt: now, role: 'member' }, [others[0]]: { role: 'host' } };
    } else throw new AppError('방장은 다른 멤버에게 방장을 넘긴 뒤에 나갈 수 있어요.');
  }
  await wr(P().db.doc('studies/' + sid), 'update', patch);
}

export async function kickMember(sid: string, uid: Uid): Promise<void> {
  guardWrite();
  const st = requireHost(sid);
  if (uid === me()) throw new AppError('자기 자신은 내보낼 수 없어요.');
  await wr(P().db.doc('studies/' + sid), 'update', { members: { [uid]: { state: 'kicked', leftAt: Date.now(), kickedCode: st.code } } });
}

export async function transferHost(sid: string, uid: Uid): Promise<void> {
  guardWrite();
  const st = requireHost(sid);
  if (!isActiveMember(st, uid)) throw new AppError('스터디에 있는 멤버에게만 넘길 수 있어요.');
  await wr(P().db.doc('studies/' + sid), 'update', { members: { [me()]: { role: 'member' }, [uid]: { role: 'host' } } });
}

export async function endStudy(sid: string): Promise<void> {
  guardWrite();
  requireHost(sid);
  await wr(P().db.doc('studies/' + sid), 'update', { status: 'ended', endedAt: Date.now() });
}

export async function reissueCode(sid: string): Promise<string> {
  guardWrite();
  requireHost(sid);
  const code = freshCode();
  await wr(P().db.doc('studies/' + sid), 'update', { code });
  return code;
}

export async function setFine(sid: string, amount: number): Promise<void> {
  guardWrite();
  const st = requireHost(sid);
  if (!(amount >= 0 && amount <= 1000000) || amount % 100 !== 0) throw new AppError('벌금은 100원 단위로, 100만 원 이하로 정해 주세요.');
  const s = getState();
  const patch: Record<string, unknown> = { fineAmount: amount };
  // 처음 켤 때는 이번 주부터 적용한다(지난 주에 소급하지 않음)
  if (amount > 0 && !st.fineFrom) patch.fineFrom = weekStart(s.today);
  if (amount === 0) patch.fineFrom = null;
  await wr(P().db.doc('studies/' + sid), 'update', patch);
}

export async function markFinePaid(sid: string, ws: string, uid: Uid, paid: boolean): Promise<void> {
  guardWrite();
  requireHost(sid);
  await wr(P().db.doc('studies/' + sid), 'update', { paid: { [`${ws}_${uid}`]: paid ? true : null } });
}

// ---------------------------------------------------------------- 인증

export interface CheckinInput {
  min: number;
  tag: string;
  memo: string;
  sids: string[];
  photos: Prepared[];
  album: boolean;
  timer: 'focus' | 'room' | null;
}

function validateCheckin(i: { min: number; tag: string; memo: string; sids: string[] }) {
  if (!(i.min >= 1)) throw new AppError('공부 시간을 1분 이상 적어 주세요.');
  if (i.min > 24 * 60) throw new AppError('하루 공부 시간은 24시간을 넘을 수 없어요.');
  if (i.memo.length > 200) throw new AppError('메모는 200자까지 쓸 수 있어요.');
  if (i.tag.length > 20) throw new AppError('과목은 20자까지 쓸 수 있어요.');
  const s = getState();
  for (const sid of i.sids) {
    const st = s.studies[sid];
    if (!st || !isActiveMember(st, me())) throw new AppError('참여하지 않은 스터디가 섞여 있어요.');
    if (isEnded(st, s.today)) throw new AppError(`'${st.name}' 스터디는 종료되어 인증을 올릴 수 없어요.`);
    if (notStarted(st, s.today)) throw new AppError(`'${st.name}' 스터디는 아직 시작 전이에요.`);
  }
}

export async function postCheckin(input: CheckinInput): Promise<string> {
  guardWrite();
  const tag = input.tag.trim();
  const memo = input.memo.trim();
  validateCheckin({ ...input, tag, memo });
  if (!input.timer && input.photos.length === 0) throw new AppError('사진을 한 장 이상 올려 주세요. 타이머로 잰 공부만 사진 없이 인증할 수 있어요.');
  if (input.photos.length > 3) throw new AppError('사진은 3장까지 올릴 수 있어요.');
  const p = P();
  const now = Date.now();
  const cid = makeTimeId(now);
  const day = dayOf(now);
  const refs: PhotoRef[] = [];
  for (const ph of input.photos) {
    const pid = makeId(14);
    let asset: string | null = null;
    if (p.assets) {
      try {
        asset = (await p.assets.upload(ph.blob, { type: 'image/jpeg' })).id;
      } catch {
        asset = null; // 자산 저장소가 거절하면 문서 저장소에 작게 담는다
      }
    }
    if (!asset) {
      const data = await inlineData(ph.blob);
      await wr(p.db.doc('photodata/' + pid), 'set', { cid, uid: me(), data });
    }
    refs.push({ pid, w: ph.w, h: ph.h, asset });
  }
  const thumbs = input.photos.map((x) => x.thumb);
  if (thumbs.length) await wr(p.db.doc('thumbs/' + cid), 'set', { day, uid: me(), t: thumbs });
  const doc: CheckIn = {
    uid: me(),
    day,
    min: Math.round(input.min),
    tag,
    memo,
    sids: input.sids,
    photos: refs,
    album: input.album,
    timer: input.timer,
    at: now,
    editedAt: null,
    r: {},
    c: {},
    rep: {},
  };
  await wr(p.db.doc('checkins/' + cid), 'set', doc as unknown as Record<string, unknown>);
  setState({ thumbs: { ...getState().thumbs, [cid]: thumbs } });
  return cid;
}

function requireEditable(cid: string): CheckIn {
  const s = getState();
  const c = s.checkins[cid];
  if (!c) throw new AppError('인증을 찾을 수 없어요.');
  if (c.uid !== me()) throw new AppError('내 인증만 바꿀 수 있어요.');
  if (c.day !== s.today) throw new AppError('그날 마감(새벽 4시)이 지난 인증은 수정하거나 지울 수 없어요.');
  return c;
}

export async function editCheckin(cid: string, input: { min: number; tag: string; memo: string; sids: string[] }): Promise<void> {
  guardWrite();
  const c = requireEditable(cid);
  const tag = input.tag.trim();
  const memo = input.memo.trim();
  validateCheckin({ ...input, tag, memo });
  const min = Math.round(input.min);
  // 타이머로 잰 시간을 손으로 고치면 "타이머 인증" 표시를 뗀다
  const timer = c.timer && min !== c.min ? null : c.timer;
  if (!timer && c.photos.length === 0) throw new AppError('사진이 없는 타이머 인증은 시간을 바꿀 수 없어요.');
  await wr(P().db.doc('checkins/' + cid), 'update', { min, tag, memo, sids: input.sids, timer, editedAt: Date.now() });
}

export async function deleteCheckin(cid: string): Promise<void> {
  guardWrite();
  const c = requireEditable(cid);
  const p = P();
  await wr(p.db.doc('checkins/' + cid), 'delete');
  dropCheckinLocal(cid);
  try {
    if (c.photos.length) await wr(p.db.doc('thumbs/' + cid), 'delete');
    for (const ph of c.photos) {
      if (ph.asset && p.assets) await p.assets.delete(ph.asset).catch(() => undefined);
      else await wr(p.db.doc('photodata/' + ph.pid), 'delete');
    }
  } catch {
    /* 사진 정리 실패는 인증 삭제 결과에 영향을 주지 않는다 */
  }
}

export async function react(cid: string, emoji: string): Promise<void> {
  guardWrite();
  const c = getState().checkins[cid];
  if (!c) return;
  const cur = c.r?.[me()];
  await wr(P().db.doc('checkins/' + cid), 'update', { r: { [me()]: cur && cur.e === emoji ? null : { e: emoji, at: Date.now() } } });
}

export async function addComment(cid: string, text: string): Promise<void> {
  guardWrite();
  const t = text.trim();
  if (!t) return;
  if (t.length > 200) throw new AppError('댓글은 200자까지 쓸 수 있어요.');
  const now = Date.now();
  await wr(P().db.doc('checkins/' + cid), 'update', { c: { [makeTimeId(now)]: { u: me(), t, at: now } } });
}

export async function deleteComment(cid: string, cmid: string): Promise<void> {
  guardWrite();
  const cm = getState().checkins[cid]?.c?.[cmid];
  if (!cm || cm.u !== me()) throw new AppError('내 댓글만 지울 수 있어요.');
  await wr(P().db.doc('checkins/' + cid), 'update', { c: { [cmid]: null } });
}

export async function reportCheckin(cid: string): Promise<void> {
  guardWrite();
  await wr(P().db.doc('checkins/' + cid), 'update', { rep: { [me()]: Date.now() } });
}

export async function reportComment(cid: string, cmid: string): Promise<void> {
  guardWrite();
  await wr(P().db.doc('checkins/' + cid), 'update', { c: { [cmid]: { rep: { [me()]: Date.now() } } } });
}

// ---------------------------------------------------------------- 사진 불러오기

const dayAsked = new Map<string, 'pending' | 'done'>();
const dayWaiters = new Map<string, Set<string>>();
const oneAsked = new Set<string>();

function putThumbs(rows: Record<string, string[]>) {
  setState({ thumbs: { ...getState().thumbs, ...rows } });
}

function ensureOneThumb(id: string) {
  if (oneAsked.has(id) || getState().thumbs[id]) return;
  oneAsked.add(id);
  P()
    .db.doc('thumbs/' + id)
    .get()
    .then((d) => putThumbs({ [id]: d.exists ? (((d.data() as { t?: string[] }).t ?? []) as string[]) : [] }))
    .catch(() => oneAsked.delete(id));
}

/** 그날 올라온 인증들의 썸네일을 한 번에 가져온다. 그 뒤에 새로 올라온 것만 하나씩 가져온다. */
export function ensureThumbs(day: string, cid: string) {
  if (getState().thumbs[cid]) return;
  const st = dayAsked.get(day);
  if (st === 'done') return ensureOneThumb(cid);
  let w = dayWaiters.get(day);
  if (!w) dayWaiters.set(day, (w = new Set()));
  w.add(cid);
  if (st === 'pending') return;
  dayAsked.set(day, 'pending');
  P()
    .db.collection('thumbs')
    .where('day', '==', day)
    .get()
    .then((snap) => {
      const rows: Record<string, string[]> = {};
      for (const d of snap.docs) rows[d.id] = ((d.data() as { t?: string[] } | undefined)?.t ?? []) as string[];
      putThumbs(rows);
      dayAsked.set(day, 'done');
      for (const id of dayWaiters.get(day) ?? []) if (!rows[id]) ensureOneThumb(id);
      dayWaiters.delete(day);
    })
    .catch(() => {
      dayAsked.delete(day);
    });
}

const fullCache = new Map<string, string>();

/** 크게 볼 사진 주소. 자산 저장소에 있으면 그 주소, 없으면 문서에서 꺼낸다. */
export async function fullPhotoUrl(ph: PhotoRef): Promise<string | null> {
  if (ph.asset) return assetUrl(ph.asset);
  const hit = fullCache.get(ph.pid);
  if (hit) return hit;
  try {
    const d = await P().db.doc('photodata/' + ph.pid).get();
    const data = d.exists ? ((d.data() as { data?: string }).data ?? null) : null;
    if (data) fullCache.set(ph.pid, data);
    return data;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 지난 기록

let mineAsked = false;
/** 내 모든 인증(개인 통계·달력·배지용) */
export async function loadMine(): Promise<void> {
  if (mineAsked) return;
  mineAsked = true;
  try {
    const snap = await P().db.collection('checkins').where('uid', '==', me()).get();
    const rows: Record<string, CheckIn> = {};
    for (const d of snap.docs) rows[d.id] = d.data() as unknown as CheckIn;
    putOlder(rows, { mineLoaded: true });
  } catch {
    mineAsked = false;
  }
}

let sinceBusy = false;
/** 실시간으로 받는 기간보다 더 예전 주를 볼 때 그 날짜부터의 인증을 가져온다. */
export async function loadSince(day: string): Promise<void> {
  const s = getState();
  if (day >= s.loadedSince || sinceBusy) return;
  sinceBusy = true;
  try {
    const snap = await P().db.collection('checkins').where('day', '>=', day).where('day', '<', s.loadedSince).get();
    const rows: Record<string, CheckIn> = {};
    for (const d of snap.docs) rows[d.id] = d.data() as unknown as CheckIn;
    putOlder(rows, { loadedSince: day });
  } catch {
    /* 다음에 다시 시도 */
  } finally {
    sinceBusy = false;
  }
}

// ---------------------------------------------------------------- 채팅

const sendCount = new Map<string, number>();

export async function sendMessage(sid: string, text: string): Promise<void> {
  guardWrite();
  const t = text.trim().slice(0, 500);
  if (!t) return;
  const s = getState();
  const st = s.studies[sid];
  if (!st || !isActiveMember(st, me())) throw new AppError('스터디 멤버만 채팅할 수 있어요.');
  if (isEnded(st, s.today)) throw new AppError('종료된 스터디에서는 채팅할 수 없어요.');
  const now = Date.now();
  const col = P().db.collection(`studies/${sid}/messages`);
  await wr(col.doc(makeTimeId(now)), 'set', { u: me(), t, at: now });
  const n = (sendCount.get(sid) ?? 0) + 1;
  sendCount.set(sid, n);
  if (n % 25 === 1) pruneChat(sid).catch(() => undefined);
}

/** 채팅방마다 최근 600개만 남긴다. */
async function pruneChat(sid: string) {
  const col = P().db.collection(`studies/${sid}/messages`);
  const snap = await col.orderBy('at', 'asc').limit(1000).get();
  const extra = snap.size - 600;
  if (extra <= 0) return;
  for (const d of snap.docs.slice(0, Math.min(extra, 120))) await wr(col.doc(d.id), 'delete');
}

export async function deleteMessage(sid: string, mid: string): Promise<void> {
  guardWrite();
  const row = getState().messages[sid]?.find((m) => m.id === mid);
  if (!row || row.u !== me()) throw new AppError('내 메시지만 지울 수 있어요.');
  await wr(P().db.collection(`studies/${sid}/messages`).doc(mid), 'delete');
}

export async function reportMessage(sid: string, mid: string): Promise<void> {
  guardWrite();
  await wr(P().db.collection(`studies/${sid}/messages`).doc(mid), 'update', { rep: { [me()]: Date.now() } });
}

// ---------------------------------------------------------------- 콕 찌르기

export async function poke(sid: string, to: Uid): Promise<void> {
  guardWrite();
  const s = getState();
  if (to === me()) return;
  const id = `${s.today}_${me()}_${to}`;
  const ref = P().db.doc('pokes/' + id);
  const cur = await ref.get().catch(() => null);
  if (cur && cur.exists) throw new AppError('오늘은 이미 콕 찔렀어요. 내일 다시 찌를 수 있어요.');
  await wr(ref, 'set', { from: me(), to, sid, day: s.today, at: Date.now() });
  lsSetPoked(id);
}

const poked = new Set<string>();
function lsSetPoked(id: string) {
  poked.add(id);
}
export function didPoke(to: Uid): boolean {
  return poked.has(`${getState().today}_${me()}_${to}`);
}

// ---------------------------------------------------------------- 설정

let settingsTimer: ReturnType<typeof setTimeout> | null = null;

async function flushSettings() {
  settingsTimer = null;
  if (getState().readOnly) return;
  markSettings(false, true);
  try {
    await wr(P().pdb.doc(P().ppath + '/settings'), 'set', getState().settings as unknown as Record<string, unknown>);
  } catch {
    /* 설정 저장 실패는 조용히 넘긴다: 화면에는 이미 반영돼 있다 */
  } finally {
    markSettings(settingsDirty, false);
    if (settingsDirty && !settingsTimer) settingsTimer = setTimeout(flushSettings, 800);
  }
}

/** 설정을 화면에 바로 반영하고, 잠깐 모았다가 한 번에 저장한다. */
export function patchSettings(fn: (s: Settings) => Settings, delay = 800) {
  setState({ settings: fn(getState().settings) });
  // 저장된 설정을 아직 받지 못했으면 저장은 미룬다(받은 설정 위에 다시 적용된다)
  if (!getState().settingsLoaded) {
    queueEarlyPatch(fn);
    return;
  }
  markSettings(true, false);
  if (settingsTimer) clearTimeout(settingsTimer);
  settingsTimer = setTimeout(flushSettings, delay);
}

onEarlyPatchesApplied(() => {
  markSettings(true, false);
  if (settingsTimer) clearTimeout(settingsTimer);
  settingsTimer = setTimeout(flushSettings, 800);
});

/** 페이지를 떠날 때: 저장을 기다리던 설정을 바로 보낸다. */
export function flushPending() {
  if (!settingsTimer) return;
  clearTimeout(settingsTimer);
  settingsTimer = null;
  void flushSettings();
}

export function markSeen() {
  patchSettings((s) => ({ ...s, seenAt: Date.now() }), 400);
  // 받은 지 일주일 넘은 콕 찌르기는 치운다
  const s = getState();
  const old = addDays(s.today, -7);
  for (const id of Object.keys(s.pokes)) {
    if (s.pokes[id].day < old) wr(P().db.doc('pokes/' + id), 'delete').catch(() => undefined);
  }
}

export function markChatRead(sid: string) {
  const s = getState();
  const rows = s.messages[sid];
  const last = rows && rows.length ? rows[rows.length - 1].at : 0;
  if ((s.settings.read[sid] ?? 0) >= last) return;
  patchSettings((x) => ({ ...x, read: { ...x.read, [sid]: Math.max(last, Date.now()) } }), 1500);
}

export function setBlocked(uid: Uid, on: boolean) {
  patchSettings((s) => ({ ...s, blocks: { ...s.blocks, [uid]: on ? true : null } }), 300);
}

// ---------------------------------------------------------------- 공부 세션(타이머)

export function elapsedSec(p: Presence | null | undefined, now: number): number {
  if (!p || !p.mode) return 0;
  const run = p.running ? Math.max(0, (now - p.startedAt) / 1000) : 0;
  return Math.min(12 * 3600, Math.floor(p.base + run));
}

function pushSession(next: Presence) {
  const local = next.mode ? next : null;
  saveSessionLocal(local);
  setState({ session: local });
  if (getState().readOnly) return;
  // 친구들에게 보이는 "공부 중" 상태. 시작·일시정지·종료 때만 쓴다.
  wr(P().db.doc('presence/' + me()), 'set', next as unknown as Record<string, unknown>).catch(() => undefined);
}

export function startSession(mode: 'focus' | 'room', subject: string) {
  const s = getState();
  if (s.session) throw new AppError(s.session.mode === 'room' ? '학습장에서 공부 중이에요. 먼저 학습을 종료해 주세요.' : '이미 공부 중이에요.');
  const now = Date.now();
  pushSession({ mode, running: true, startedAt: now, base: 0, subject: subject.trim().slice(0, 20), began: now, at: now });
}

export function pauseSession() {
  const cur = getState().session;
  if (!cur || !cur.running) return;
  const now = Date.now();
  pushSession({ ...cur, running: false, base: elapsedSec(cur, now), at: now });
}

export function resumeSession() {
  const cur = getState().session;
  if (!cur || cur.running) return;
  const now = Date.now();
  pushSession({ ...cur, running: true, startedAt: now, at: now });
}

export function setSessionSubject(subject: string) {
  const cur = getState().session;
  if (!cur) return;
  pushSession({ ...cur, subject: subject.trim().slice(0, 20), at: Date.now() });
}

export function setPending(p: PendingSession | null) {
  savePendingLocal(p);
  setState({ pending: p });
}

/** 공부 끝내기. 잰 시간을 "아직 인증하지 않은 공부"로 남긴다. */
export function stopSession(): PendingSession | null {
  const cur = getState().session;
  if (!cur || !cur.mode) return null;
  const now = Date.now();
  const sec = elapsedSec(cur, now);
  pushSession({ mode: null, running: false, startedAt: now, base: 0, subject: '', began: cur.began, at: now });
  if (sec < 60) return null;
  const prev = getState().pending;
  // 인증하지 않은 공부가 남아 있으면 시간을 합친다
  const pending: PendingSession = prev
    ? { sec: prev.sec + sec, mode: cur.mode, subject: cur.subject || prev.subject, began: prev.began, ended: now }
    : { sec, mode: cur.mode, subject: cur.subject, began: cur.began, ended: now };
  setPending(pending);
  return pending;
}

async function endSessionQuietly() {
  const cur = getState().session;
  if (!cur) return;
  const now = Date.now();
  pushSession({ mode: null, running: false, startedAt: now, base: 0, subject: '', began: cur.began, at: now });
}

// ---------------------------------------------------------------- 학습장 자료

const EXT_KIND: Record<string, { kind: MaterialKind; mime: string }> = {
  pdf: { kind: 'pdf', mime: 'application/pdf' },
  html: { kind: 'html', mime: 'text/plain' },
  htm: { kind: 'html', mime: 'text/plain' },
  png: { kind: 'image', mime: 'image/png' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  gif: { kind: 'image', mime: 'image/gif' },
  webp: { kind: 'image', mime: 'image/webp' },
  txt: { kind: 'text', mime: 'text/plain' },
  md: { kind: 'md', mime: 'text/markdown' },
  markdown: { kind: 'md', mime: 'text/markdown' },
};

export const MATERIAL_ACCEPT = '.pdf,.html,.htm,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.markdown,application/pdf,text/html,text/plain,text/markdown,image/png,image/jpeg,image/gif,image/webp';
export const MATERIAL_MAX = 20 * 1024 * 1024;

function materialsCol() {
  return P().pdb.doc(P().ppath + '/lib').collection('materials');
}

export async function addMaterialFile(file: File, subject: string): Promise<{ mid: string; deviceOnly: boolean }> {
  guardWrite();
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  const info = EXT_KIND[ext];
  if (!info) throw new AppError('이 형식은 열 수 없어요. PDF, HTML, 이미지, 텍스트(.txt, .md) 파일을 올려 주세요.');
  if (file.size > MATERIAL_MAX) throw new AppError('파일이 20MB를 넘어요. 더 작은 파일로 나눠 올려 주세요.');
  if (file.size === 0) throw new AppError('빈 파일이에요.');
  const p = P();
  const mid = makeTimeId(Date.now());
  // 글자 파일은 UTF-8로 다시 저장한다(옛 인코딩 대비)
  let blob: Blob = file;
  if (info.kind === 'html' || info.kind === 'text' || info.kind === 'md') blob = new Blob([await readText(file)], { type: info.mime });
  let asset: string | null = null;
  if (p.assets) {
    try {
      asset = (await p.assets.upload(blob, { type: info.mime })).id;
    } catch {
      asset = null;
    }
  }
  // 저장소에 올린 파일도 이 기기에 사본을 둔다: 다시 열 때 내려받지 않고, 저장소가 파일을 내주지 않아도 볼 수 있다
  if (asset) blobPut('matc:' + mid, blob).catch(() => undefined);
  else await blobPut('mat:' + mid, blob);
  const title = file.name.replace(/\.[^.]+$/, '').slice(0, 60) || '자료';
  const doc: Material = { title, subject: subject.trim().slice(0, 20), kind: info.kind, mime: info.mime, size: blob.size, asset, local: asset ? null : p.deviceId, url: null, page: 1, at: Date.now() };
  try {
    await wr(materialsCol().doc(mid), 'set', doc as unknown as Record<string, unknown>);
  } catch (e) {
    if (asset && p.assets) p.assets.delete(asset).catch(() => undefined);
    blobDel((asset ? 'matc:' : 'mat:') + mid).catch(() => undefined);
    throw e;
  }
  return { mid, deviceOnly: !asset };
}

export async function addMaterialLink(urlRaw: string, title: string, subject: string): Promise<string> {
  guardWrite();
  let url = urlRaw.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('scheme');
  } catch {
    throw new AppError('주소를 다시 확인해 주세요. 예: https://example.com');
  }
  const mid = makeTimeId(Date.now());
  const doc: Material = { title: title.trim().slice(0, 60) || url.replace(/^https?:\/\//, '').slice(0, 60), subject: subject.trim().slice(0, 20), kind: 'link', mime: '', size: 0, asset: null, local: null, url, at: Date.now() };
  await wr(materialsCol().doc(mid), 'set', doc as unknown as Record<string, unknown>);
  return mid;
}

export async function updateMaterial(mid: string, patch: Partial<Pick<Material, 'title' | 'subject' | 'page'>>): Promise<void> {
  if (getState().readOnly) return;
  const clean: Record<string, unknown> = {};
  if (patch.title !== undefined) clean.title = patch.title.trim().slice(0, 60) || '자료';
  if (patch.subject !== undefined) clean.subject = patch.subject.trim().slice(0, 20);
  if (patch.page !== undefined) clean.page = patch.page;
  await wr(materialsCol().doc(mid), 'update', clean);
}

export async function removeMaterial(mid: string): Promise<void> {
  guardWrite();
  const m = getState().materials[mid];
  if (!m) return;
  await wr(materialsCol().doc(mid), 'delete');
  if (m.asset && P().assets) await P().assets!.delete(m.asset).catch(() => undefined);
  await blobDel('mat:' + mid);
  await blobDel('matc:' + mid);
}

/** 자료 파일 내용. 이 기기에 없으면 null. */
export async function materialBlob(mid: string, m: Material): Promise<Blob | null> {
  if (!m.asset) return await blobGet('mat:' + mid);
  const copy = await blobGet('matc:' + mid);
  if (copy) return copy;
  let res: Response;
  try {
    res = await fetch(assetUrl(m.asset));
  } catch {
    throw new AppError('자료를 불러오지 못했어요. 연결 상태를 확인하고 다시 열어 주세요.');
  }
  if (!res.ok) throw new AppError('자료를 불러오지 못했어요. 처음 올린 기기에서는 열 수 있어요.');
  const blob = await res.blob();
  blobPut('matc:' + mid, blob).catch(() => undefined);
  return blob;
}

export { normalizeCode };
