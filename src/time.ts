// 시간 계산. 모든 집계는 한국 시간(KST) 기준이고, 하루는 새벽 4시에 바뀐다.

const KST = 9 * 3600e3;
const CUT = 4 * 3600e3;
const DAY = 864e5;

/** ts가 속한 "공부 날짜" (YYYY-MM-DD). 새벽 4시 전은 전날로 친다. */
export function dayOf(ts: number): string {
  return new Date(ts + KST - CUT).toISOString().slice(0, 10);
}

/** 공부 날짜가 시작되는 순간(그날 04:00 KST)의 ms. */
export function dayStartTs(day: string): number {
  return Date.parse(day + 'T00:00:00Z') - KST + CUT;
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(day + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DAY);
}

/** 0 = 일요일 */
export function dow(day: string): number {
  return new Date(day + 'T00:00:00Z').getUTCDay();
}

/** 그 날짜가 속한 주의 월요일 */
export function weekStart(day: string): string {
  return addDays(day, -((dow(day) + 6) % 7));
}

export function monthOf(day: string): string {
  return day.slice(0, 7);
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

export function dowName(day: string): string {
  return DOW[dow(day)];
}

/** "11월 10일 (화)" */
export function fmtDay(day: string, withDow = true): string {
  const m = Number(day.slice(5, 7));
  const d = Number(day.slice(8, 10));
  return `${m}월 ${d}일` + (withDow ? ` (${dowName(day)})` : '');
}

/** "11/10" */
export function fmtShort(day: string): string {
  return `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
}

/** KST 시각 "오후 9:05" */
export function fmtClock(ts: number): string {
  const d = new Date(ts + KST);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ap = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ap} ${h12}:${String(m).padStart(2, '0')}`;
}

/** ts의 달력 날짜(KST, 자정 기준). 시각을 그대로 보여 줄 때 쓴다. */
export function calDayOf(ts: number): string {
  return new Date(ts + KST).toISOString().slice(0, 10);
}

/** "방금", "5분 전", "오후 3:20", "11/9 오후 3:20" */
export function fmtAgo(ts: number, now: number): string {
  const diff = now - ts;
  if (diff < 60e3) return '방금';
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)}분 전`;
  // 시계 옆의 날짜는 달력 날짜다(새벽 2시 55분은 그날 날짜로 적는다)
  if (calDayOf(ts) === calDayOf(now)) return fmtClock(ts);
  return `${fmtShort(calDayOf(ts))} ${fmtClock(ts)}`;
}

/** 분 → "2시간 5분" */
export function fmtMin(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}분`;
  if (r === 0) return `${h}시간`;
  return `${h}시간 ${r}분`;
}

/** 초 → "01:23:45" */
export function fmtTimer(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** 하루가 시작된 뒤(04:00) 지난 분. 'HH:MM'(KST)을 같은 기준으로 바꿀 때도 쓴다. */
export function minutesIntoDay(ts: number): number {
  const d = new Date(ts + KST);
  return (d.getUTCHours() * 60 + d.getUTCMinutes() - 240 + 1440) % 1440;
}

export function clockToDayMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return ((h || 0) * 60 + (m || 0) - 240 + 1440) % 1440;
}

/** KST 시(0~23) */
export function kstHour(ts: number): number {
  return new Date(ts + KST).getUTCHours();
}

export function isValidDay(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}
