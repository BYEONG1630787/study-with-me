// 마이: 프로필, 개인 통계, 달력, 배지, 참여 중인 스터디, 설정.

import React, { useEffect, useMemo, useState } from 'react';
import { isForcedLocal, leaveLocal, useApp } from '../store';
import { loadMine, withdraw } from '../actions';
import { myCheckins, myStudies } from '../derive';
import { badgesOf, personalStats, type DayAgg } from '../logic';
import { addDays, dayOf, dow, fmtDay, fmtMin, monthOf, weekStart } from '../time';
import { confirmSheet, go, openSheet, resetUi } from '../ui';
import { CheckinCard } from './feed';
import { Avatar, Btn, Icon, Nick, Stamp, useAsync } from './kit';

function monthDays(month: string): string[] {
  const out: string[] = [];
  let d = month + '-01';
  while (monthOf(d) === month) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

function Calendar({ month, byDay, today, sel, onSel }: { month: string; byDay: Map<string, DayAgg>; today: string; sel: string | null; onSel: (d: string) => void }) {
  const days = monthDays(month);
  const lead = (dow(days[0]) + 6) % 7; // 월요일부터 시작
  return (
    <div className="cal">
      {['월', '화', '수', '목', '금', '토', '일'].map((d) => (
        <span key={d} className="cal-dow" aria-hidden="true">
          {d}
        </span>
      ))}
      {Array.from({ length: lead }, (_, i) => (
        <span key={'pad' + i} className="cal-pad" />
      ))}
      {days.map((d) => {
        const agg = byDay.get(d);
        const future = d > today;
        return (
          <button
            key={d}
            type="button"
            className={'cal-day' + (agg ? ' has' : '') + (d === today ? ' today' : '') + (d === sel ? ' sel' : '')}
            disabled={future}
            onClick={() => onSel(d)}
            aria-pressed={d === sel}
            aria-label={`${fmtDay(d)}${agg ? `, 인증 ${agg.n}건, ${fmtMin(agg.min)}` : ', 인증 없음'}`}
          >
            <span className="cal-num">{Number(d.slice(8))}</span>
            {agg ? <Stamp size={30} /> : null}
          </button>
        );
      })}
    </div>
  );
}

export function MyPage() {
  const s = useApp((x) => x);
  const [busy, run] = useAsync();
  useEffect(() => {
    loadMine();
  }, []);
  const me = s.profiles[s.uid];
  const mine = useMemo(() => myCheckins(s), [s.checkins, s.uid]); // eslint-disable-line react-hooks/exhaustive-deps
  const stats = useMemo(() => personalStats(mine, s.today), [mine, s.today]);
  const badges = useMemo(() => badgesOf(stats), [stats]);
  const [month, setMonth] = useState(monthOf(s.today));
  const [sel, setSel] = useState<string | null>(null);
  const studies = useMemo(() => myStudies(s), [s.studies, s.uid, s.today]); // eslint-disable-line react-hooks/exhaustive-deps
  const firstMonth = monthOf(me ? dayOf(me.createdAt) : s.today);
  const minMonth = mine.reduce((m, c) => (monthOf(c.day) < m ? monthOf(c.day) : m), firstMonth);

  const ws = weekStart(s.today);
  let weekMin = 0;
  let weekDays = 0;
  let monthMin = 0;
  let monthCount = 0;
  for (const [d, a] of stats.byDay) {
    if (d >= ws && d <= addDays(ws, 6)) {
      weekMin += a.min;
      weekDays++;
    }
    if (monthOf(d) === month) {
      monthMin += a.min;
      monthCount++;
    }
  }
  const selIds = sel
    ? Object.keys(s.checkins)
        .filter((id) => s.checkins[id].uid === s.uid && s.checkins[id].day === sel)
        .sort((a, b) => s.checkins[a].at - s.checkins[b].at)
    : [];
  const got = badges.filter((b) => b.got).length;

  const quit = () =>
    confirmSheet({
      title: '정말 탈퇴할까요?',
      body: '프로필이 지워지고 모든 스터디에서 나가요. 올렸던 인증은 "탈퇴한 사용자"의 기록으로 남고, 되돌릴 수 없어요.',
      okLabel: '탈퇴',
      danger: true,
      onOk: async () => {
        if (await run(() => withdraw(), '탈퇴했어요')) resetUi();
      },
    });

  return (
    <div className="page my">
      <section className="card profile-card">
        <Avatar uid={s.uid} size={64} />
        <div className="grow">
          <p className="profile-name">
            <Nick uid={s.uid} />
          </p>
          <p className="faint tiny">{me ? `${fmtDay(dayOf(me.createdAt), false)}부터 함께하는 중` : ''}</p>
        </div>
        <Btn kind="soft" size="sm" icon="edit" onClick={() => openSheet({ kind: 'profile' })} disabled={s.readOnly} id="my-edit">
          수정
        </Btn>
      </section>

      <section>
        <h2 className="sec-title">
          내 기록
          {!s.mineLoaded ? <span className="faint">불러오는 중…</span> : null}
        </h2>
        <div className="tiles four">
          <div className="tile">
            <span className="tile-label">누적 공부 시간</span>
            <span className="tile-value">{fmtMin(stats.totalMin)}</span>
          </div>
          <div className="tile">
            <span className="tile-label">총 인증</span>
            <span className="tile-value">{stats.count}회</span>
          </div>
          <div className="tile">
            <span className="tile-label">연속 인증</span>
            <span className="tile-value">{stats.streak.current}일</span>
          </div>
          <div className="tile">
            <span className="tile-label">최장 연속</span>
            <span className="tile-value">{stats.streak.longest}일</span>
          </div>
          <div className="tile">
            <span className="tile-label">이번 주 공부 시간</span>
            <span className="tile-value">{fmtMin(weekMin)}</span>
            <span className="tile-sub">{weekDays}일 인증</span>
          </div>
          <div className="tile">
            <span className="tile-label">{Number(month.slice(5))}월 공부 시간</span>
            <span className="tile-value">{fmtMin(monthMin)}</span>
            <span className="tile-sub">{monthCount}일 인증</span>
          </div>
        </div>
      </section>

      <section>
        <div className="week-nav">
          <Btn kind="ghost" size="sm" icon="left" disabled={month <= minMonth} onClick={() => setMonth(shiftMonth(month, -1))} label="이전 달" id="cal-prev" />
          <p className="week-label grow center">
            {month.slice(0, 4)}년 {Number(month.slice(5))}월
          </p>
          <Btn kind="ghost" size="sm" icon="right" disabled={month >= monthOf(s.today)} onClick={() => setMonth(shiftMonth(month, 1))} label="다음 달" id="cal-next" />
        </div>
        <div className="card">
          <Calendar month={month} byDay={stats.byDay} today={s.today} sel={sel} onSel={(d) => setSel(sel === d ? null : d)} />
        </div>
        {sel ? (
          <div className="col gap day-detail">
            <h3 className="day-head">
              <span>{fmtDay(sel)}</span>
              <span className="faint">{stats.byDay.get(sel) ? `${stats.byDay.get(sel)!.n}건 · ${fmtMin(stats.byDay.get(sel)!.min)}` : '인증 없음'}</span>
            </h3>
            {selIds.map((id) => (
              <CheckinCard key={id} id={id} c={s.checkins[id]} showStudies />
            ))}
          </div>
        ) : (
          <p className="hint">도장이 찍힌 날을 누르면 그날 올린 인증을 볼 수 있어요.</p>
        )}
      </section>

      <section>
        <h2 className="sec-title">
          배지
          <span className="faint">
            {got}/{badges.length}
          </span>
        </h2>
        <ul className="badges">
          {badges.map((b) => (
            <li key={b.id} className={'badge-item' + (b.got ? ' got' : '')}>
              <span className="badge-medal" aria-hidden="true">
                <Icon name={b.id.startsWith('s') ? 'fire' : b.id.startsWith('h') ? 'timer' : b.id === 'timer' ? 'lock' : 'check'} size={18} />
              </span>
              <span className="badge-name">{b.name}</span>
              <span className="badge-desc">{b.got ? b.desc : '아직 받지 못했어요'}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="sec-title">
          참여 중인 스터디
          <span className="faint">{studies.filter((r) => !r.ended).length}개</span>
        </h2>
        {studies.length === 0 ? (
          <p className="muted">아직 참여한 스터디가 없어요.</p>
        ) : (
          <ul className="list card flush">
            {studies.map((r) => (
              <li key={r.sid}>
                <button type="button" className="list-row as-btn" onClick={() => go({ name: 'study', sid: r.sid, tab: 'today' })}>
                  <span className="grow">
                    <span className="row-title">
                      {r.study.name}
                      {r.ended ? <span className="chip mute sm">종료</span> : null}
                    </span>
                  </span>
                  <Icon name="right" size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="sec-title">설정</h2>
        <ul className="list card flush">
          <li>
            <button type="button" className="list-row as-btn" onClick={() => openSheet({ kind: 'notifSettings' })} id="my-notif">
              <Icon name="bell" size={18} />
              <span className="grow">알림 설정</span>
              <Icon name="right" size={16} />
            </button>
          </li>
          <li>
            <button type="button" className="list-row as-btn" onClick={() => openSheet({ kind: 'blocks' })} id="my-blocks">
              <Icon name="flag" size={18} />
              <span className="grow">차단 목록</span>
              <Icon name="right" size={16} />
            </button>
          </li>
          <li>
            <button type="button" className="list-row as-btn" onClick={() => openSheet({ kind: 'help' })} id="my-help">
              <Icon name="info" size={18} />
              <span className="grow">사용 안내 · 친구 초대 방법</span>
              <Icon name="right" size={16} />
            </button>
          </li>
          <li>
            <button type="button" className="list-row as-btn" onClick={() => openSheet({ kind: 'terms' })} id="my-terms">
              <Icon name="file" size={18} />
              <span className="grow">이용 규칙과 개인정보 안내</span>
              <Icon name="right" size={16} />
            </button>
          </li>
          {s.mode === 'local' && isForcedLocal() ? (
            <li>
              <button type="button" className="list-row as-btn" onClick={() => run(() => leaveLocal())} id="my-leave-local">
                <Icon name="link" size={18} />
                <span className="grow">체험 모드 끝내고 함께 쓰는 저장소로 돌아가기</span>
                <Icon name="right" size={16} />
              </button>
            </li>
          ) : null}
        </ul>
        <p className="hint">{s.mode === 'cloud' ? '기록은 친구들과 함께 쓰는 저장소에 저장돼요.' : '체험 모드: 기록이 이 기기의 브라우저에만 저장돼요.'}</p>
        <div className="center">
          <Btn kind="ghost" size="sm" busy={busy} onClick={quit} disabled={s.readOnly} id="my-withdraw">
            회원 탈퇴
          </Btn>
        </div>
      </section>
    </div>
  );
}
