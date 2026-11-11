// 스터디 화면: 오늘 현황, 피드, 채팅, 통계(주간 현황·랭킹·벌금), 정보·관리.

import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store';
import { didPoke, elapsedSec, endStudy, kickMember, leaveStudy, loadSince, markFinePaid, poke, reissueCode, transferHost } from '../actions';
import { isStudying, nickOf, todayBoard, unreadCount } from '../derive';
import { activeMemberIds, buildIndex, fineLedger, hostOf, isActiveMember, isEnded, notStarted, pendingRule, ranking, ruleForWeek, studyWeek, weekResult, type DayIndex, type WeekResult } from '../logic';
import { addDays, dayOf, diffDays, dowName, fmtDay, fmtMin, fmtShort, weekStart } from '../time';
import type { RuleRev, Study, Uid } from '../types';
import { back, confirmSheet, goTab, openSheet, replaceRoute, type MenuItem, type StudyTab } from '../ui';
import { Chat } from './chat';
import { Feed } from './feed';
import { Avatar, Btn, Empty, Icon, Nick, Seg, Stamp, useAsync, useNow } from './kit';

export function ruleText(r: RuleRev): string {
  return `주 ${r.weekly}회` + (r.dailyMin > 0 ? ` · 하루 ${fmtMin(r.dailyMin)} 이상` : '');
}

export function won(n: number): string {
  return n.toLocaleString('ko-KR') + '원';
}

/** 한 주 7칸: 인증한 날은 도장 색으로 채운다. */
export function WeekDots({ res, today }: { res: WeekResult; today: string }) {
  return (
    <div className="wd-row" role="img" aria-label={`이번 주 인증 ${res.count}회, 목표 ${res.target}회`}>
      {res.days.map((d) => {
        const cls = !d.inSpan ? 'off' : d.state === 'done' ? 'done' : d.state === 'partial' ? 'partial' : d.future ? 'future' : 'none';
        return (
          <span key={d.day} className={'wd ' + cls + (d.day === today ? ' today' : '')} title={`${fmtDay(d.day)}${d.min ? ' · ' + fmtMin(d.min) : ''}`}>
            <span className="wd-dow">{dowName(d.day)}</span>
            <span className="wd-mark">{cls === 'done' ? <Icon name="check" size={12} /> : null}</span>
          </span>
        );
      })}
    </div>
  );
}

export function StudyPage({ sid, tab }: { sid: string; tab: StudyTab }) {
  const study = useApp((s) => s.studies[sid]);
  const loaded = useApp((s) => s.studiesLoaded);
  const uid = useApp((s) => s.uid);
  const today = useApp((s) => s.today);
  const unread = useApp((s) => unreadCount(s, sid));

  if (!study) {
    return (
      <div className="page">
        <div className="study-head">
          <Btn kind="ghost" size="sm" icon="left" onClick={back} label="뒤로" />
        </div>
        {loaded ? <Empty icon="users" title="스터디를 찾을 수 없어요" body="지워졌거나 주소가 잘못됐을 수 있어요." /> : <p className="center faint pad">불러오는 중…</p>}
      </div>
    );
  }

  const member = isActiveMember(study, uid);
  const ended = isEnded(study, today);
  const early = notStarted(study, today);
  const rule = ruleForWeek(study, weekStart(today));
  const count = activeMemberIds(study).length;

  if (!member) {
    const mine = study.members[uid];
    return (
      <div className="page">
        <div className="study-head">
          <Btn kind="ghost" size="sm" icon="left" onClick={back} label="뒤로" />
          <div className="grow">
            <h1 className="study-name">{study.name}</h1>
          </div>
        </div>
        <Empty
          icon="lock"
          title={mine?.state === 'kicked' ? '방장이 내보낸 스터디예요' : mine?.state === 'left' ? '나간 스터디예요' : '이 스터디의 멤버가 아니에요'}
          body="스터디 안의 인증과 채팅은 멤버만 볼 수 있어요. 초대 코드가 있으면 참여할 수 있어요."
        >
          {!ended ? (
            <Btn kind="soft" onClick={() => openSheet({ kind: 'join' })}>
              초대 코드로 참여
            </Btn>
          ) : null}
        </Empty>
      </div>
    );
  }

  const tabs: { value: StudyTab; label: string; badge?: number }[] = [
    { value: 'today', label: '오늘' },
    { value: 'feed', label: '피드' },
    { value: 'chat', label: '채팅', badge: tab === 'chat' ? 0 : unread },
    { value: 'stats', label: '통계' },
    { value: 'info', label: '정보' },
  ];

  return (
    <div className={'page study' + (tab === 'chat' ? ' fill' : '')}>
      <div className="study-head">
        <Btn kind="ghost" size="sm" icon="left" onClick={back} label="뒤로" />
        <div className="grow">
          <h1 className="study-name">
            {study.name}
            {ended ? <span className="chip mute sm">종료</span> : early ? <span className="chip sm">시작 전</span> : null}
          </h1>
          <p className="faint tiny">
            멤버 {count}명 · {ruleText(rule)}
          </p>
        </div>
        {!ended ? (
          <Btn kind="soft" size="sm" icon="link" onClick={() => openSheet({ kind: 'invite', sid })} id="study-invite">
            초대
          </Btn>
        ) : null}
      </div>
      <Seg id="study-tabs" options={tabs} value={tab} onChange={(v) => replaceRoute({ name: 'study', sid, tab: v })} />
      {tab === 'today' ? <TodayTab sid={sid} study={study} /> : null}
      {tab === 'feed' ? <Feed sid={sid} /> : null}
      {tab === 'chat' ? <Chat sid={sid} /> : null}
      {tab === 'stats' ? <StatsTab sid={sid} study={study} /> : null}
      {tab === 'info' ? <InfoTab sid={sid} study={study} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------ 오늘

function TodayTab({ sid, study }: { sid: string; study: Study }) {
  const s = useApp((x) => x);
  const now = useNow(15000);
  const [, bump] = useState(0);
  const [, run] = useAsync();
  const board = useMemo(() => todayBoard(s, sid), [s.checkins, s.studies, s.today, sid]); // eslint-disable-line react-hooks/exhaustive-deps
  const idx = useMemo(() => buildIndex(Object.values(s.checkins), sid), [s.checkins, sid]);
  const ended = isEnded(study, s.today);
  const early = notStarted(study, s.today);
  const open = !ended && !early;
  const host = hostOf(study);
  const ws = weekStart(s.today);
  const mine = weekResult(study, idx, s.uid, ws, s.today);
  const me = board.find((r) => r.uid === s.uid);
  const doneCount = board.filter((r) => r.state === 'done').length;
  const rule = ruleForWeek(study, ws);

  return (
    <div className="col gap-lg">
      {early ? (
        <p className="note">
          {fmtDay(study.start)}에 시작해요. 시작까지 {diffDays(study.start, s.today)}일 남았어요.
        </p>
      ) : null}
      {ended ? <p className="note">종료된 스터디예요. 지난 인증과 통계는 계속 볼 수 있어요.</p> : null}

      {open && mine ? (
        <section className="card my-week">
          <div className="row between">
            <div>
              <p className="label">이번 주 내 인증</p>
              <p className="big-count num">
                {mine.count}
                <span className="faint"> / {mine.target}회</span>
              </p>
            </div>
            {mine.achieved ? <Stamp text="달성" size={52} /> : null}
          </div>
          <WeekDots res={mine} today={s.today} />
          {me && me.state !== 'done' ? (
            <div className="row gap wrap">
              <Btn icon="camera" onClick={() => openSheet({ kind: 'checkin' })} disabled={s.readOnly} id="today-checkin">
                {me.state === 'partial' ? `${fmtMin(Math.max(0, rule.dailyMin - me.min))} 더 인증하기` : '오늘 인증 올리기'}
              </Btn>
              <span className="faint tiny">마감은 새벽 4시예요.</span>
            </div>
          ) : (
            <p className="muted">오늘 인증을 마쳤어요. 수고했어요!</p>
          )}
        </section>
      ) : null}

      <section>
        <h2 className="sec-title">
          오늘 현황
          {open ? (
            <span className="faint">
              {doneCount}/{board.length}명 인증
            </span>
          ) : null}
        </h2>
        <ul className="list card flush">
          {board.map((r) => {
            const studying = isStudying(s, r.uid, now);
            const p = r.uid === s.uid ? s.session : s.presence[r.uid];
            const poked = didPoke(r.uid);
            return (
              <li key={r.uid} className="list-row">
                <span className={'av-wrap' + (studying ? ' live' : '')}>
                  <Avatar uid={r.uid} size={40} />
                </span>
                <span className="grow">
                  <span className="row-title">
                    <Nick uid={r.uid} />
                    {r.uid === host ? (
                      <span className="chip mute sm">
                        <Icon name="crown" size={12} />
                        방장
                      </span>
                    ) : null}
                  </span>
                  <span className="row-sub">
                    {studying && p ? (
                      <span className="live-text">
                        공부 중{p.subject ? ` · ${p.subject}` : ''} · {fmtMin(Math.floor(elapsedSec(p, now) / 60))}
                      </span>
                    ) : (
                      `이번 주 ${r.count}/${r.target}회${r.min ? ` · 오늘 ${fmtMin(r.min)}` : ''}`
                    )}
                  </span>
                </span>
                <span className="row-end">
                  {r.state === 'done' ? (
                    <Stamp />
                  ) : !open ? null : r.uid === s.uid ? (
                    <span className="chip mute">{r.state === 'partial' ? '조금 더' : '아직'}</span>
                  ) : (
                    <Btn
                      kind="line"
                      size="sm"
                      icon="poke"
                      disabled={poked || s.readOnly}
                      onClick={() =>
                        run(async () => {
                          try {
                            await poke(sid, r.uid);
                          } finally {
                            bump((n) => n + 1);
                          }
                        }, `${nickOf(s.profiles, r.uid)}님을 콕 찔렀어요`)
                      }
                    >
                      {poked ? '찔렀어요' : '콕 찌르기'}
                    </Btn>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        {open ? <p className="hint">아직 인증하지 않은 친구는 하루에 한 번 콕 찌를 수 있어요.</p> : null}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ 통계

function StatsTab({ sid, study }: { sid: string; study: Study }) {
  const s = useApp((x) => x);
  const lastDay = useMemo(() => {
    let d = s.today;
    if (study.end && study.end < d) d = study.end;
    if (study.status === 'ended' && study.endedAt && dayOf(study.endedAt) < d) d = dayOf(study.endedAt);
    return d;
  }, [s.today, study.end, study.status, study.endedAt]);
  const firstWs = weekStart(study.start);
  const lastWs = weekStart(lastDay < study.start ? study.start : lastDay);
  const [ws, setWs] = useState(lastWs);
  const idx = useMemo(() => buildIndex(Object.values(s.checkins), sid), [s.checkins, sid]);
  const week = useMemo(() => studyWeek(study, idx, ws, s.today), [study, idx, ws, s.today]);
  const rank = useMemo(() => ranking(week), [week]);
  const need = study.fineAmount && study.fineFrom && study.fineFrom < ws ? study.fineFrom : ws;
  const loading = need < s.loadedSince;

  useEffect(() => {
    if (need < s.loadedSince) loadSince(need < study.start ? weekStart(study.start) : need);
  }, [need, s.loadedSince, study.start]);

  const thisWs = weekStart(s.today);
  const label = ws === thisWs ? '이번 주' : ws === addDays(thisWs, -7) ? '지난주' : null;
  const ongoing = addDays(ws, 6) >= s.today && !isEnded(study, s.today);
  const maxMin = Math.max(1, ...rank.map((r) => r.minutes));
  const allDone = week.results.length > 0 && week.achieved === week.results.length;
  const rule = ruleForWeek(study, ws);

  return (
    <div className="col gap-lg">
      <div className="week-nav">
        <Btn kind="ghost" size="sm" icon="left" disabled={ws <= firstWs} onClick={() => setWs(addDays(ws, -7))} label="이전 주" id="stats-prev" />
        <div className="center grow">
          <p className="week-label">
            {fmtDay(ws, false)} ~ {fmtDay(addDays(ws, 6), false)}
          </p>
          <p className="faint tiny">
            {label ? label + ' · ' : ''}
            {ruleText(rule)}
          </p>
        </div>
        <Btn kind="ghost" size="sm" icon="right" disabled={ws >= lastWs} onClick={() => setWs(addDays(ws, 7))} label="다음 주" id="stats-next" />
      </div>

      {week.results.length === 0 ? (
        <Empty icon="chart" title={loading ? '기록을 불러오는 중…' : '이 주에는 인증 대상이 없어요'} body={loading ? undefined : '스터디가 시작되기 전이거나 멤버가 없던 주예요.'} />
      ) : (
        <>
          <section className="card rate-card">
            <div className="grow">
              <p className="label">{ongoing ? '지금까지 목표를 채운 멤버' : '목표를 달성한 멤버'}</p>
              <p className="big-count num">
                {week.achieved}
                <span className="faint"> / {week.results.length}명</span>
              </p>
              <div className="meter" role="img" aria-label={`달성률 ${Math.round(week.rate * 100)}%`}>
                <span style={{ width: `${Math.round(week.rate * 100)}%` }} />
              </div>
            </div>
            {allDone ? <Stamp text={ongoing ? '전원 달성' : '참 잘했어요'} size={72} /> : null}
          </section>

          <section>
            <h2 className="sec-title">주간 현황</h2>
            <ul className="list card flush">
              {week.results
                .slice()
                .sort((a, b) => Number(b.achieved) - Number(a.achieved) || b.count - a.count || (a.uid < b.uid ? -1 : 1))
                .map((r) => (
                  <li key={r.uid} className="list-row week-row">
                    <Avatar uid={r.uid} size={34} />
                    <span className="grow">
                      <span className="row-title">
                        <Nick uid={r.uid} />
                        {!isActiveMember(study, r.uid) ? <span className="chip mute sm">나감</span> : null}
                      </span>
                      <WeekDots res={r} today={s.today} />
                    </span>
                    <span className="row-end">
                      <span className="num week-count">
                        {r.count}/{r.target}
                      </span>
                      {r.achieved ? <span className="chip stamp-chip">달성</span> : r.ongoing && ongoing ? <span className="chip mute">진행 중</span> : <span className="chip warn">미달성</span>}
                    </span>
                  </li>
                ))}
            </ul>
          </section>

          <section>
            <h2 className="sec-title">
              공부 시간 랭킹
              <span className="faint">이 스터디에 올린 인증 기준</span>
            </h2>
            <ol className="list card flush rank-list">
              {rank.map((r, i) => (
                <li key={r.uid} className={'list-row rank-row' + (r.uid === s.uid ? ' mine' : '')}>
                  <span className={'rank-no num' + (i === 0 && r.minutes > 0 ? ' top' : '')}>{i === 0 && r.minutes > 0 ? <Icon name="trophy" size={18} /> : i + 1}</span>
                  <Avatar uid={r.uid} size={30} />
                  <span className="grow">
                    <span className="row-title">
                      <Nick uid={r.uid} />
                    </span>
                    <span className="rank-bar" aria-hidden="true">
                      <span style={{ width: `${Math.round((r.minutes / maxMin) * 100)}%` }} />
                    </span>
                  </span>
                  <span className="row-end">
                    <span className="num rank-min">{fmtMin(r.minutes)}</span>
                    <span className="faint tiny">{r.count}일 인증</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}

      <Fines sid={sid} study={study} idx={idx} loading={loading} />
    </div>
  );
}

function Fines({ sid, study, idx, loading }: { sid: string; study: Study; idx: DayIndex; loading: boolean }) {
  const uid = useApp((s) => s.uid);
  const today = useApp((s) => s.today);
  const readOnly = useApp((s) => s.readOnly);
  const [, run] = useAsync();
  const isHost = hostOf(study) === uid;
  const ledger = useMemo(() => fineLedger(study, idx, today), [study, idx, today]);
  const ended = isEnded(study, today);

  if (!study.fineAmount) {
    if (!isHost || ended) return null;
    return (
      <section>
        <h2 className="sec-title">벌금 장부</h2>
        <div className="card row between gap">
          <p className="muted grow">주간 목표를 못 채운 멤버에게 벌금을 기록하는 규칙이에요. 지금은 꺼져 있어요.</p>
          <Btn kind="soft" size="sm" icon="coin" onClick={() => openSheet({ kind: 'fine', sid })} id="fine-open">
            벌금 설정
          </Btn>
        </div>
      </section>
    );
  }

  const unpaid = ledger.filter((e) => !e.paid).reduce((a, e) => a + e.amount, 0);
  const paid = ledger.filter((e) => e.paid).reduce((a, e) => a + e.amount, 0);
  const weeks: { ws: string; rows: typeof ledger }[] = [];
  for (const e of ledger) {
    const g = weeks[weeks.length - 1];
    if (g && g.ws === e.ws) g.rows.push(e);
    else weeks.push({ ws: e.ws, rows: [e] });
  }

  return (
    <section>
      <h2 className="sec-title">
        벌금 장부
        {isHost && !ended ? (
          <button type="button" className="text-btn" onClick={() => openSheet({ kind: 'fine', sid })} id="fine-open">
            설정
          </button>
        ) : null}
      </h2>
      <div className="card col gap">
        <p className="muted">
          주간 목표 미달성 1회당 <b>{won(study.fineAmount)}</b>
          {study.fineFrom ? ` · ${fmtShort(study.fineFrom)} 주부터 적용` : ''}
        </p>
        <div className="tiles two">
          <div className="tile">
            <span className="tile-label">미납</span>
            <span className="tile-value num">{won(unpaid)}</span>
          </div>
          <div className="tile">
            <span className="tile-label">납부 완료</span>
            <span className="tile-value num">{won(paid)}</span>
          </div>
        </div>
        {ledger.length === 0 ? <p className="faint">{loading ? '기록을 불러오는 중…' : '아직 벌금이 없어요. 한 주가 끝나면 목표를 못 채운 멤버가 여기에 기록돼요.'}</p> : null}
        {weeks.map((g) => (
          <div key={g.ws} className="fine-week">
            <p className="label">
              {fmtShort(g.ws)} ~ {fmtShort(addDays(g.ws, 6))}
            </p>
            <ul className="list">
              {g.rows.map((e) => (
                <li key={e.uid} className="list-row tight">
                  <Avatar uid={e.uid} size={28} />
                  <span className="grow">
                    <span className="row-title">
                      <Nick uid={e.uid} />
                    </span>
                    <span className="row-sub">
                      인증 {e.count}/{e.target}회
                    </span>
                  </span>
                  <span className="num">{won(e.amount)}</span>
                  {isHost ? (
                    <label className="paid-check" htmlFor={`paid-${e.ws}-${e.uid}`}>
                      <input id={`paid-${e.ws}-${e.uid}`} type="checkbox" checked={e.paid} disabled={readOnly} onChange={(ev) => run(() => markFinePaid(sid, e.ws, e.uid, ev.target.checked))} />
                      <span>납부</span>
                    </label>
                  ) : (
                    <span className={'chip ' + (e.paid ? 'good' : 'warn')}>{e.paid ? '납부' : '미납'}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="hint">앱은 장부만 기록해요. 실제 돈은 멤버끼리 직접 주고받고, 방장이 납부 여부를 표시해요.</p>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ 정보·관리

function InfoTab({ sid, study }: { sid: string; study: Study }) {
  const s = useApp((x) => x);
  const [busy, run] = useAsync();
  const uid = s.uid;
  const host = hostOf(study);
  const isHost = host === uid;
  const ended = isEnded(study, s.today);
  const members = activeMemberIds(study);
  const gone = Object.keys(study.members).filter((u) => study.members[u].state !== 'active');
  const cur = ruleForWeek(study, weekStart(s.today));
  const next = pendingRule(study, s.today);
  const dday = study.end ? diffDays(study.end, s.today) : null;

  const memberMenu = (u: Uid) => {
    const name = nickOf(s.profiles, u);
    const items: MenuItem[] = [
      {
        label: '방장 넘기기',
        run: () =>
          confirmSheet({
            title: `${name}님에게 방장을 넘길까요?`,
            body: '넘긴 뒤에는 스터디 수정, 멤버 내보내기, 벌금 관리를 새 방장이 맡아요.',
            okLabel: '넘기기',
            onOk: () => run(() => transferHost(sid, u), '방장을 넘겼어요'),
          }),
      },
      {
        label: '스터디에서 내보내기',
        danger: true,
        run: () =>
          confirmSheet({
            title: `${name}님을 내보낼까요?`,
            body: '지난 인증 기록은 남아요. 다시 들어오려면 초대 코드를 새로 발급해서 알려 줘야 해요.',
            okLabel: '내보내기',
            danger: true,
            onOk: () => run(() => kickMember(sid, u), '내보냈어요'),
          }),
      },
    ];
    openSheet({ kind: 'menu', title: name, items });
  };

  const leave = () => {
    const alone = members.length === 1;
    if (isHost && !alone) {
      confirmSheet({ title: '방장은 바로 나갈 수 없어요', body: '멤버 목록에서 다른 멤버에게 방장을 넘긴 뒤에 나갈 수 있어요.', okLabel: '확인', onOk: () => undefined });
      return;
    }
    confirmSheet({
      title: '스터디에서 나갈까요?',
      body: alone ? '혼자 남은 스터디라 나가면 스터디가 종료돼요.' : '내가 올린 인증은 스터디 기록에 남아요. 초대 코드가 있으면 다시 들어올 수 있어요.',
      okLabel: '나가기',
      danger: true,
      onOk: async () => {
        if (
          await run(async () => {
            await leaveStudy(sid);
          }, '스터디에서 나갔어요')
        )
          goTab('home');
      },
    });
  };

  return (
    <div className="col gap-lg">
      <section className="card col gap">
        {study.intro ? <p className="intro">{study.intro}</p> : null}
        <dl className="kv">
          <dt>기간</dt>
          <dd>
            {fmtDay(study.start)} ~ {study.status === 'ended' && study.endedAt ? fmtDay(dayOf(study.endedAt)) : study.end ? fmtDay(study.end) : '종료일 없음'}
            {!ended && dday !== null ? <span className="chip sm">{dday === 0 ? '오늘까지' : `D-${dday}`}</span> : null}
            {ended ? <span className="chip mute sm">종료</span> : null}
          </dd>
          <dt>인증 규칙</dt>
          <dd>
            {ruleText(cur)}
            {next ? (
              <span className="kv-sub">
                {fmtShort(next.from)}(월)부터: {ruleText(next)}
              </span>
            ) : null}
            <span className="kv-sub">하루는 새벽 4시에 바뀌고, 한 주는 월요일에 시작해요.</span>
          </dd>
          <dt>인원</dt>
          <dd>
            {members.length} / {study.max}명
          </dd>
          <dt>벌금</dt>
          <dd>{study.fineAmount ? `주간 목표 미달성 1회당 ${won(study.fineAmount)}` : '없음'}</dd>
          {!ended ? (
            <>
              <dt>초대 코드</dt>
              <dd>
                <span className="code-inline num">{study.code}</span>
                <button type="button" className="text-btn" onClick={() => openSheet({ kind: 'invite', sid })}>
                  초대하기
                </button>
              </dd>
            </>
          ) : null}
        </dl>
      </section>

      <section>
        <h2 className="sec-title">
          멤버
          <span className="faint">{members.length}명</span>
        </h2>
        <ul className="list card flush">
          {members.map((u) => (
            <li key={u} className="list-row">
              <Avatar uid={u} size={36} />
              <span className="grow">
                <span className="row-title">
                  <Nick uid={u} />
                  {u === host ? (
                    <span className="chip mute sm">
                      <Icon name="crown" size={12} />
                      방장
                    </span>
                  ) : null}
                </span>
                <span className="row-sub">{fmtShort(dayOf(study.members[u].joinedAt))} 참여</span>
              </span>
              {isHost && u !== uid && !ended ? (
                <button type="button" className="mini-more" onClick={() => memberMenu(u)} aria-label={`${nickOf(s.profiles, u)} 관리`}>
                  <Icon name="more" size={18} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {gone.length > 0 ? <p className="hint">나간 멤버 {gone.length}명의 지난 인증은 통계에 남아 있어요.</p> : null}
      </section>

      {!ended ? (
        <section className="col gap">
          {isHost ? (
            <>
              <h2 className="sec-title">방장 메뉴</h2>
              <div className="btn-grid">
                <Btn kind="soft" icon="edit" onClick={() => openSheet({ kind: 'editStudy', sid })} id="study-edit">
                  스터디 수정
                </Btn>
                <Btn kind="soft" icon="coin" onClick={() => openSheet({ kind: 'fine', sid })}>
                  벌금 설정
                </Btn>
                <Btn
                  kind="soft"
                  icon="link"
                  busy={busy}
                  onClick={() =>
                    confirmSheet({
                      title: '초대 코드를 다시 발급할까요?',
                      body: '지금 코드는 더 이상 쓸 수 없게 돼요. 이미 들어온 멤버에게는 영향이 없어요.',
                      okLabel: '다시 발급',
                      onOk: () => run(() => reissueCode(sid), '새 초대 코드를 만들었어요'),
                    })
                  }
                >
                  코드 다시 발급
                </Btn>
                <Btn
                  kind="line"
                  icon="stop"
                  onClick={() =>
                    confirmSheet({
                      title: '스터디를 종료할까요?',
                      body: '종료하면 새 인증과 채팅을 올릴 수 없어요. 지난 기록과 통계는 계속 볼 수 있고, 되돌릴 수 없어요.',
                      okLabel: '종료',
                      danger: true,
                      onOk: () => run(() => endStudy(sid), '스터디를 종료했어요'),
                    })
                  }
                >
                  스터디 종료
                </Btn>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      <div className="center">
        <Btn kind="ghost" icon="leave" onClick={leave} id="study-leave">
          스터디 나가기
        </Btn>
      </div>
    </div>
  );
}
