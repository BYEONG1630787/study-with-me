// 달성 여부, 스트릭, 랭킹, 벌금, 배지 계산. 화면과 무관한 순수 함수만 둔다.

import { addDays, dayOf, weekStart } from './time';
import type { CheckIn, Member, RuleRev, Study, Uid } from './types';
import { REPORT_HIDE } from './types';

export interface DayAgg {
  min: number;
  n: number;
}
export type DayIndex = Map<Uid, Map<string, DayAgg>>;

/** 사용자별·날짜별 공부 시간 합계. sid를 주면 그 스터디에 올린 인증만 센다. */
export function buildIndex(checkins: Iterable<CheckIn>, sid: string | null): DayIndex {
  const idx: DayIndex = new Map();
  for (const c of checkins) {
    if (sid && !c.sids.includes(sid)) continue;
    let u = idx.get(c.uid);
    if (!u) idx.set(c.uid, (u = new Map()));
    const a = u.get(c.day);
    if (a) {
      a.min += c.min;
      a.n += 1;
    } else u.set(c.day, { min: c.min, n: 1 });
  }
  return idx;
}

export function isEnded(study: Study, today: string): boolean {
  return study.status === 'ended' || (!!study.end && study.end < today);
}

export function notStarted(study: Study, today: string): boolean {
  return study.start > today;
}

export function activeMemberIds(study: Study): Uid[] {
  return Object.keys(study.members)
    .filter((u) => study.members[u] && study.members[u].state === 'active')
    .sort((a, b) => study.members[a].joinedAt - study.members[b].joinedAt);
}

export function isActiveMember(study: Study, uid: Uid): boolean {
  const m = study.members[uid];
  return !!m && m.state === 'active';
}

export function hostOf(study: Study): Uid | null {
  return activeMemberIds(study).find((u) => study.members[u].role === 'host') ?? null;
}

/** 그 주(월요일 ws)에 적용되는 규칙. 첫 주는 처음 규칙을 쓴다. */
export function ruleForWeek(study: Study, ws: string): RuleRev {
  const rules = [...study.rules].sort((a, b) => (a.from < b.from ? -1 : 1));
  let cur = rules[0];
  for (const r of rules) if (r.from <= ws) cur = r;
  return cur;
}

/** 다음 주부터 바뀔 예정인 규칙(없으면 null) */
export function pendingRule(study: Study, today: string): RuleRev | null {
  const ws = weekStart(today);
  // 가장 이른 규칙은 처음 정한 규칙이라 "예정"으로 보지 않는다
  const rules = [...study.rules].sort((a, b) => (a.from < b.from ? -1 : 1));
  return rules.slice(1).find((r) => r.from > ws) ?? null;
}

/** 멤버가 그 스터디에서 인증 대상이었던 기간 */
export function memberSpan(study: Study, uid: Uid): { from: string; to: string | null } | null {
  const m: Member | undefined = study.members[uid];
  if (!m) return null;
  const joined = dayOf(m.joinedAt);
  const from = joined > study.start ? joined : study.start;
  let to: string | null = study.end;
  const cap = (d: string) => {
    if (!to || d < to) to = d;
  };
  if (study.status === 'ended' && study.endedAt) cap(dayOf(study.endedAt));
  if (m.state !== 'active' && m.leftAt) cap(dayOf(m.leftAt));
  return { from, to };
}

export type DayState = 'done' | 'partial' | 'none';

export function dayState(agg: DayAgg | undefined, rule: RuleRev): DayState {
  if (!agg || agg.n === 0) return 'none';
  return agg.min >= rule.dailyMin ? 'done' : 'partial';
}

export interface WeekDay {
  day: string;
  state: DayState;
  inSpan: boolean;
  future: boolean;
  min: number;
}

export interface WeekResult {
  uid: Uid;
  ws: string;
  count: number;
  target: number;
  minutes: number;
  achieved: boolean;
  ongoing: boolean;
  days: WeekDay[];
  rule: RuleRev;
}

/** 한 멤버의 한 주 결과. 그 주에 인증 대상인 날이 없으면 null. */
export function weekResult(study: Study, idx: DayIndex, uid: Uid, ws: string, today: string): WeekResult | null {
  const span = memberSpan(study, uid);
  if (!span) return null;
  const rule = ruleForWeek(study, ws);
  const mine = idx.get(uid);
  let active = 0;
  let count = 0;
  let minutes = 0;
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    const inSpan = d >= span.from && (!span.to || d <= span.to);
    const agg = mine?.get(d);
    const state = dayState(agg, rule);
    if (inSpan) {
      active++;
      if (state === 'done') count++;
      if (agg) minutes += agg.min;
    }
    days.push({ day: d, state, inSpan, future: d > today, min: agg?.min ?? 0 });
  }
  if (active === 0) return null;
  const target = Math.min(rule.weekly, active);
  return { uid, ws, count, target, minutes, achieved: count >= target, ongoing: addDays(ws, 6) >= today, days, rule };
}

export interface StudyWeek {
  ws: string;
  results: WeekResult[];
  achieved: number;
  rate: number; // 0~1
}

/** 스터디의 한 주 결과: 그 주에 대상이었던 모든 멤버(나간 멤버 포함). */
export function studyWeek(study: Study, idx: DayIndex, ws: string, today: string): StudyWeek {
  const results: WeekResult[] = [];
  for (const uid of Object.keys(study.members)) {
    const r = weekResult(study, idx, uid, ws, today);
    if (r) results.push(r);
  }
  const achieved = results.filter((r) => r.achieved).length;
  return { ws, results, achieved, rate: results.length ? achieved / results.length : 0 };
}

/** 주간 랭킹: 공부 시간 순, 같으면 인증한 날 수 순. */
export function ranking(week: StudyWeek): WeekResult[] {
  return [...week.results].sort((a, b) => b.minutes - a.minutes || b.count - a.count || (a.uid < b.uid ? -1 : 1));
}

export interface Streak {
  current: number;
  longest: number;
}

/** 연속 인증 일수. 오늘 아직 인증 전이면 어제까지의 연속을 유지한 것으로 본다. */
export function streakOf(days: Set<string>, today: string): Streak {
  let current = 0;
  let d = days.has(today) ? today : addDays(today, -1);
  while (days.has(d)) {
    current++;
    d = addDays(d, -1);
  }
  let longest = 0;
  let run = 0;
  let prev = '';
  for (const x of [...days].sort()) {
    run = prev && addDays(prev, 1) === x ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = x;
  }
  return { current, longest: Math.max(longest, current) };
}

export interface FineEntry {
  ws: string;
  uid: Uid;
  amount: number;
  paid: boolean;
  count: number;
  target: number;
}

/** 벌금 장부: 벌금 적용 주부터 끝난 주까지, 목표를 못 채운 멤버마다 한 줄. 최신 주가 먼저. */
export function fineLedger(study: Study, idx: DayIndex, today: string): FineEntry[] {
  if (!study.fineAmount || !study.fineFrom) return [];
  const out: FineEntry[] = [];
  const first = weekStart(study.fineFrom > study.start ? study.fineFrom : study.start);
  let ws = weekStart(addDays(today, -7));
  let guard = 0;
  while (ws >= first && guard++ < 520) {
    const wk = studyWeek(study, idx, ws, today);
    for (const r of wk.results) {
      if (r.ongoing || r.achieved) continue;
      out.push({ ws, uid: r.uid, amount: study.fineAmount, paid: !!study.paid?.[`${ws}_${r.uid}`], count: r.count, target: r.target });
    }
    ws = addDays(ws, -7);
  }
  return out;
}

export interface PersonalStats {
  count: number;
  totalMin: number;
  days: Set<string>;
  byDay: Map<string, DayAgg>;
  streak: Streak;
  timerCount: number;
}

export function personalStats(mine: CheckIn[], today: string): PersonalStats {
  const byDay = new Map<string, DayAgg>();
  let totalMin = 0;
  let timerCount = 0;
  for (const c of mine) {
    totalMin += c.min;
    if (c.timer) timerCount++;
    const a = byDay.get(c.day);
    if (a) {
      a.min += c.min;
      a.n++;
    } else byDay.set(c.day, { min: c.min, n: 1 });
  }
  const days = new Set(byDay.keys());
  return { count: mine.length, totalMin, days, byDay, streak: streakOf(days, today), timerCount };
}

export interface Badge {
  id: string;
  name: string;
  desc: string;
  got: boolean;
}

export function badgesOf(s: PersonalStats): Badge[] {
  const h = s.totalMin / 60;
  const L = s.streak.longest;
  const defs: [string, string, string, boolean][] = [
    ['first', '첫 인증', '첫 번째 인증을 올렸어요', s.count >= 1],
    ['s3', '3일 연속', '사흘 내리 인증했어요', L >= 3],
    ['s7', '7일 연속', '일주일을 하루도 빠짐없이', L >= 7],
    ['s14', '14일 연속', '2주 동안 끊기지 않았어요', L >= 14],
    ['s30', '30일 연속', '한 달 개근', L >= 30],
    ['s100', '100일 연속', '백일 개근', L >= 100],
    ['c10', '인증 10회', '인증을 10번 올렸어요', s.count >= 10],
    ['c50', '인증 50회', '인증을 50번 올렸어요', s.count >= 50],
    ['c100', '인증 100회', '인증을 100번 올렸어요', s.count >= 100],
    ['h10', '누적 10시간', '공부 시간이 10시간을 넘었어요', h >= 10],
    ['h50', '누적 50시간', '공부 시간이 50시간을 넘었어요', h >= 50],
    ['h100', '누적 100시간', '공부 시간이 100시간을 넘었어요', h >= 100],
    ['h300', '누적 300시간', '공부 시간이 300시간을 넘었어요', h >= 300],
    ['timer', '타이머 인증', '타이머로 잰 공부를 인증했어요', s.timerCount >= 1],
  ];
  return defs.map(([id, name, desc, got]) => ({ id, name, desc, got }));
}

export function reportCount(rep: Record<string, number> | undefined | null): number {
  return rep ? Object.keys(rep).filter((k) => rep[k]).length : 0;
}

export function isHiddenByReports(rep: Record<string, number> | undefined | null): boolean {
  return reportCount(rep) >= REPORT_HIDE;
}

/** 초대 코드: 헷갈리는 글자(0/O, 1/I/L)를 뺀 6자리 */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function makeCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
  return s;
}

export function normalizeCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function makeId(len = 16): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  const buf = new Uint8Array(len);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
  else for (let i = 0; i < len; i++) buf[i] = Math.floor(Math.random() * 256);
  for (let i = 0; i < len; i++) s += chars[buf[i] % chars.length];
  return s;
}

/** 시간순 정렬용 id: 시각(36진수 9자리) + 무작위 */
export function makeTimeId(now: number): string {
  return now.toString(36).padStart(9, '0') + makeId(7);
}
