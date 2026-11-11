// 상태에서 화면용 값을 뽑는 함수들.

import type { AppState } from './store';
import { activeMemberIds, buildIndex, isActiveMember, isEnded, isHiddenByReports, notStarted, weekResult } from './logic';
import { addDays, clockToDayMinutes, dayStartTs, fmtMin, minutesIntoDay, weekStart } from './time';
import type { CheckIn, Profile, Study, Uid } from './types';
import type { Route } from './ui';

export const NO_NAME = '탈퇴한 사용자';

export function nickOf(profiles: Record<Uid, Profile>, uid: Uid): string {
  const p = profiles[uid];
  if (!p || p.deleted || !p.nick) return NO_NAME;
  return p.nick;
}

export interface StudyRow {
  sid: string;
  study: Study;
  ended: boolean;
}

/** 내가 참여 중인 스터디: 진행 중인 것 먼저, 만든 순서대로 */
export function myStudies(s: AppState): StudyRow[] {
  const rows: StudyRow[] = [];
  for (const sid of Object.keys(s.studies)) {
    const study = s.studies[sid];
    if (!isActiveMember(study, s.uid)) continue;
    rows.push({ sid, study, ended: isEnded(study, s.today) });
  }
  return rows.sort((a, b) => Number(a.ended) - Number(b.ended) || a.study.createdAt - b.study.createdAt);
}

/** 오늘 인증을 올릴 수 있는 스터디 */
export function postableStudies(s: AppState): StudyRow[] {
  return myStudies(s).filter((r) => !r.ended && !notStarted(r.study, s.today));
}

export function isBlocked(s: AppState, uid: Uid): boolean {
  return !!s.settings.blocks[uid];
}

/** 스터디 피드에 보일 인증(최신순). 차단한 사람과 신고로 가려진 글은 뺀다. */
export function feedOf(s: AppState, sid: string): { id: string; c: CheckIn }[] {
  const out: { id: string; c: CheckIn }[] = [];
  for (const id of Object.keys(s.checkins)) {
    const c = s.checkins[id];
    if (!c.sids.includes(sid)) continue;
    if (isBlocked(s, c.uid)) continue;
    out.push({ id, c });
  }
  return out.sort((a, b) => b.c.at - a.c.at);
}

export function myCheckins(s: AppState): CheckIn[] {
  return Object.values(s.checkins).filter((c) => c.uid === s.uid);
}

export function todayMinutes(s: AppState): number {
  let m = 0;
  for (const c of Object.values(s.checkins)) if (c.uid === s.uid && c.day === s.today) m += c.min;
  return m;
}

export function unreadCount(s: AppState, sid: string): number {
  const rows = s.messages[sid];
  if (!rows) return 0;
  const seen = s.settings.read[sid] ?? 0;
  let n = 0;
  for (const m of rows) if (m.at > seen && m.u !== s.uid && !isBlocked(s, m.u) && !isHiddenByReports(m.rep)) n++;
  return n;
}

export function totalUnread(s: AppState): number {
  let n = 0;
  for (const sid of Object.keys(s.messages)) n += unreadCount(s, sid);
  return n;
}

/** 지금 공부 중인 사람(12시간 넘게 변화가 없으면 뺀다) */
export function isStudying(s: AppState, uid: Uid, now: number): boolean {
  const p = uid === s.uid ? s.session : s.presence[uid];
  return !!p && !!p.mode && now - p.at < 12 * 3600e3;
}

export interface Notif {
  id: string;
  at: number;
  kind: 'checkin' | 'react' | 'comment' | 'poke' | 'weekly' | 'remind';
  text: string;
  sub?: string;
  uid?: Uid;
  route?: Route;
  cid?: string;
}

/** 리마인더를 띄울 때인지: 오늘 인증이 없고, 정한 시각이 지났고, 인증할 스터디가 있을 때 */
export function remindDue(s: AppState, now: number): boolean {
  if (!s.settings.notif.remind) return false;
  if (postableStudies(s).length === 0) return false;
  if (minutesIntoDay(now) < clockToDayMinutes(s.settings.notif.remindAt)) return false;
  for (const c of Object.values(s.checkins)) if (c.uid === s.uid && c.day === s.today) return false;
  return true;
}

export function buildNotifs(s: AppState, now: number): Notif[] {
  const out: Notif[] = [];
  const n = s.settings.notif;
  const mine = myStudies(s);
  const mySids = new Set(mine.map((r) => r.sid));
  const weekAgo = addDays(s.today, -7);

  for (const id of Object.keys(s.checkins)) {
    const c = s.checkins[id];
    if (c.day < weekAgo) continue;
    if (c.uid !== s.uid) {
      if (!n.friend || isBlocked(s, c.uid) || isHiddenByReports(c.rep)) continue;
      const sid = c.sids.find((x) => mySids.has(x));
      if (!sid) continue;
      out.push({
        id: 'ci:' + id,
        at: c.at,
        kind: 'checkin',
        uid: c.uid,
        text: `${nickOf(s.profiles, c.uid)}님이 인증을 올렸어요`,
        sub: `${s.studies[sid].name} · ${fmtMin(c.min)}`,
        route: { name: 'study', sid, tab: 'feed' },
        cid: id,
      });
      continue;
    }
    if (!n.react) continue;
    const sid = c.sids.find((x) => mySids.has(x)) ?? c.sids[0];
    const route: Route | undefined = sid && s.studies[sid] ? { name: 'study', sid, tab: 'feed' } : undefined;
    for (const u of Object.keys(c.r ?? {})) {
      const r = c.r![u];
      if (!r || u === s.uid || isBlocked(s, u)) continue;
      out.push({ id: `r:${id}:${u}`, at: r.at, kind: 'react', uid: u, text: `${nickOf(s.profiles, u)}님이 내 인증에 ${r.e} 반응을 남겼어요`, route, cid: id });
    }
    for (const k of Object.keys(c.c ?? {})) {
      const cm = c.c![k];
      if (!cm || cm.u === s.uid || isBlocked(s, cm.u) || isHiddenByReports(cm.rep)) continue;
      out.push({ id: `c:${id}:${k}`, at: cm.at, kind: 'comment', uid: cm.u, text: `${nickOf(s.profiles, cm.u)}님이 댓글을 남겼어요`, sub: cm.t, route, cid: id });
    }
  }

  if (n.poke) {
    for (const id of Object.keys(s.pokes)) {
      const p = s.pokes[id];
      if (p.day < weekAgo || isBlocked(s, p.from)) continue;
      const st = s.studies[p.sid];
      out.push({
        id: 'p:' + id,
        at: p.at,
        kind: 'poke',
        uid: p.from,
        text: `${nickOf(s.profiles, p.from)}님이 콕 찔렀어요`,
        sub: '공부하자!',
        route: st && mySids.has(p.sid) ? { name: 'study', sid: p.sid, tab: 'today' } : undefined,
      });
    }
  }

  if (n.weekly) {
    const ws = weekStart(s.today);
    const last = addDays(ws, -7);
    const at = dayStartTs(ws) + 5 * 3600e3; // 월요일 오전 9시
    if (now >= at) {
      for (const r of mine) {
        if (r.study.start > addDays(last, 6)) continue;
        const idx = buildIndex(Object.values(s.checkins), r.sid);
        const res = weekResult(r.study, idx, s.uid, last, s.today);
        if (!res) continue;
        out.push({
          id: `w:${r.sid}:${last}`,
          at,
          kind: 'weekly',
          text: `${r.study.name} 지난주 결과: ${res.achieved ? '목표 달성' : '목표 미달성'}`,
          sub: `인증 ${res.count}/${res.target}회 · ${fmtMin(res.minutes)}`,
          route: { name: 'study', sid: r.sid, tab: 'stats' },
        });
      }
    }
  }

  if (remindDue(s, now)) {
    const mins = clockToDayMinutes(n.remindAt);
    out.push({ id: 'remind:' + s.today, at: dayStartTs(s.today) + mins * 60e3, kind: 'remind', text: '오늘 인증이 아직 없어요', sub: '마감은 새벽 4시예요.' });
  }

  return out.sort((a, b) => b.at - a.at).slice(0, 80);
}

export function unseenNotifs(s: AppState, now: number): number {
  return buildNotifs(s, now).filter((x) => x.at > s.settings.seenAt).length;
}

export interface MemberToday {
  uid: Uid;
  state: 'done' | 'partial' | 'none';
  min: number;
  count: number;
  target: number;
  achieved: boolean;
}

/** 스터디 멤버별 오늘 상태와 이번 주 진행 */
export function todayBoard(s: AppState, sid: string): MemberToday[] {
  const study = s.studies[sid];
  if (!study) return [];
  const idx = buildIndex(Object.values(s.checkins), sid);
  const ws = weekStart(s.today);
  const rows: MemberToday[] = [];
  for (const uid of activeMemberIds(study)) {
    const res = weekResult(study, idx, uid, ws, s.today);
    const d = res?.days.find((x) => x.day === s.today);
    rows.push({ uid, state: d?.state ?? 'none', min: d?.min ?? 0, count: res?.count ?? 0, target: res?.target ?? 0, achieved: !!res?.achieved });
  }
  return rows;
}

/** 과목 추천: 내 자료의 과목과 최근 인증의 과목 */
export function subjectHints(s: AppState): string[] {
  const seen = new Map<string, number>();
  for (const m of Object.values(s.materials)) if (m.subject) seen.set(m.subject, Math.max(seen.get(m.subject) ?? 0, m.at));
  for (const c of Object.values(s.checkins)) if (c.uid === s.uid && c.tag) seen.set(c.tag, Math.max(seen.get(c.tag) ?? 0, c.at));
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]).slice(0, 8);
}
