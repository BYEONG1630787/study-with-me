// 홈: 오늘 상태, 아직 인증하지 않은 공부, 내 스터디, 지금 공부 중인 친구.

import React, { useEffect, useMemo } from 'react';
import { useApp, type AppState } from '../store';
import { elapsedSec, loadMine, setPending } from '../actions';
import { isStudying, myCheckins, myStudies, remindDue, todayBoard, todayMinutes, unreadCount, type StudyRow } from '../derive';
import { activeMemberIds, buildIndex, notStarted, personalStats, weekResult } from '../logic';
import { fmtDay, fmtMin, weekStart } from '../time';
import type { Uid } from '../types';
import { confirmSheet, go, openSheet } from '../ui';
import { Avatar, Btn, Empty, Icon, Nick, Stamp, useNow } from './kit';
import { WeekDots } from './study';

/** 누를 수 있는 카드에 붙이는 속성(버튼 안에 블록 요소를 넣지 않기 위해) */
export function pressable(fn: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: fn,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fn();
      }
    },
  };
}

function StudyCard({ s, row, now }: { s: AppState; row: StudyRow; now: number }) {
  const { sid, study } = row;
  const board = todayBoard(s, sid);
  const idx = buildIndex(Object.values(s.checkins), sid);
  const res = weekResult(study, idx, s.uid, weekStart(s.today), s.today);
  const done = board.filter((b) => b.state === 'done').length;
  const unread = unreadCount(s, sid);
  const early = notStarted(study, s.today);
  return (
    <li>
      <div className="study-card" {...pressable(() => go({ name: 'study', sid, tab: 'today' }))} aria-label={`${study.name} 스터디 열기`}>
        <div className="row between gap">
          <span className="study-card-name">{study.name}</span>
          <span className="row gap-sm">
            {unread > 0 ? (
              <span className="badge" aria-label={`읽지 않은 메시지 ${unread}개`}>
                {unread > 99 ? '99+' : unread}
              </span>
            ) : null}
            <Icon name="right" size={16} />
          </span>
        </div>
        {early ? (
          <p className="faint tiny">{fmtDay(study.start)}에 시작해요</p>
        ) : res ? (
          <div className="row between gap">
            <WeekDots res={res} today={s.today} />
            <span className="week-count num">
              {res.count}/{res.target}회
            </span>
          </div>
        ) : null}
        <div className="row between gap">
          <span className="av-stack">
            {board.slice(0, 7).map((b) => (
              <span key={b.uid} className={'av-wrap sm' + (b.state === 'done' ? ' done' : '') + (isStudying(s, b.uid, now) ? ' live' : '')}>
                <Avatar uid={b.uid} size={26} />
              </span>
            ))}
            {board.length > 7 ? <span className="faint tiny">+{board.length - 7}</span> : null}
          </span>
          {!early ? (
            <span className="faint tiny">
              오늘 {done}/{board.length}명 인증
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function HomePage() {
  const s = useApp((x) => x);
  const now = useNow(20000);
  useEffect(() => {
    loadMine();
  }, []);
  const rows = useMemo(() => myStudies(s), [s.studies, s.uid, s.today]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = rows.filter((r) => !r.ended);
  const ended = rows.filter((r) => r.ended);
  const mine = useMemo(() => myCheckins(s), [s.checkins, s.uid]); // eslint-disable-line react-hooks/exhaustive-deps
  const stats = useMemo(() => personalStats(mine, s.today), [mine, s.today]);
  const todayMin = todayMinutes(s);
  const checked = stats.days.has(s.today);
  const friends = useMemo(() => {
    const set = new Set<Uid>();
    for (const r of open) for (const u of activeMemberIds(r.study)) if (u !== s.uid && !s.settings.blocks[u] && isStudying(s, u, now)) set.add(u);
    return [...set];
  }, [open, s.presence, s.settings.blocks, now]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page home">
      <section className="hero">
        <div className="hero-top">
          <div>
            <p className="eyebrow">{fmtDay(s.today)}</p>
            <h1 className="display">{checked ? '오늘 한 장, 채웠어요' : '오늘 한 장, 채워 볼까요'}</h1>
          </div>
          {checked ? <Stamp text="인증" size={64} /> : <Stamp text="인증" size={64} faded />}
        </div>
        <div className="tiles two">
          <div className="tile">
            <span className="tile-label">오늘 공부</span>
            <span className="tile-value">{fmtMin(todayMin)}</span>
          </div>
          <div className="tile">
            <span className="tile-label">연속 인증</span>
            <span className="tile-value">{stats.streak.current}일</span>
          </div>
        </div>
        <div className="row gap wrap">
          <Btn size="lg" icon="camera" onClick={() => openSheet({ kind: 'checkin' })} disabled={s.readOnly} id="home-checkin">
            인증 올리기
          </Btn>
          <Btn size="lg" kind="soft" icon="lock" onClick={() => openSheet({ kind: 'startFocus' })} id="home-focus">
            공부 시작
          </Btn>
        </div>
        {remindDue(s, now) ? <p className="hint">오늘 인증이 아직 없어요. 마감은 새벽 4시예요.</p> : null}
      </section>

      {s.pending ? (
        <section className="card pending" aria-label="아직 인증하지 않은 공부">
          <Icon name="timer" size={22} />
          <div className="grow">
            <p className="row-title">아직 인증하지 않은 공부 {fmtMin(Math.floor(s.pending.sec / 60))}</p>
            <p className="faint tiny">{s.pending.mode === 'room' ? '학습장' : '집중 모드'} 타이머로 쟀어요. 오늘 마감 전까지 인증할 수 있어요.</p>
          </div>
          <Btn size="sm" onClick={() => openSheet({ kind: 'checkin', fromTimer: true })} disabled={s.readOnly} id="pending-checkin">
            인증하기
          </Btn>
          <Btn
            kind="ghost"
            size="sm"
            icon="trash"
            label="잰 시간 버리기"
            onClick={() => confirmSheet({ title: '잰 시간을 버릴까요?', body: '버리면 이 공부 시간으로는 인증할 수 없어요.', okLabel: '버리기', danger: true, onOk: () => setPending(null) })}
          />
        </section>
      ) : null}

      {friends.length > 0 ? (
        <section>
          <h2 className="sec-title">
            지금 공부 중인 친구
            <span className="faint">{friends.length}명</span>
          </h2>
          <ul className="live-list">
            {friends.map((u) => {
              const p = s.presence[u];
              return (
                <li key={u} className="live-chip">
                  <span className="av-wrap live">
                    <Avatar uid={u} size={32} />
                  </span>
                  <span className="live-col">
                    <span className="row-title">
                      <Nick uid={u} />
                    </span>
                    <span className="live-text tiny">
                      {p?.subject || '공부 중'} · {fmtMin(Math.floor(elapsedSec(p, now) / 60))}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="sec-title">
          내 스터디
          {open.length > 0 ? <span className="faint">{open.length}개</span> : null}
        </h2>
        {!s.studiesLoaded ? (
          <p className="center faint pad">불러오는 중…</p>
        ) : open.length === 0 ? (
          <Empty icon="users" title="아직 참여 중인 스터디가 없어요" body="스터디를 만들고 친구를 초대하거나, 친구에게 받은 초대 코드로 들어가 보세요.">
            <Btn icon="plus" onClick={() => openSheet({ kind: 'createStudy' })} disabled={s.readOnly} id="home-create">
              스터디 만들기
            </Btn>
            <Btn kind="soft" onClick={() => openSheet({ kind: 'join' })} disabled={s.readOnly} id="home-join">
              초대 코드로 참여
            </Btn>
          </Empty>
        ) : (
          <>
            <ul className="study-cards">
              {open.map((r) => (
                <StudyCard key={r.sid} s={s} row={r} now={now} />
              ))}
            </ul>
            <div className="row gap wrap">
              <Btn kind="soft" size="sm" icon="plus" onClick={() => openSheet({ kind: 'createStudy' })} disabled={s.readOnly} id="home-create">
                스터디 만들기
              </Btn>
              <Btn kind="ghost" size="sm" onClick={() => openSheet({ kind: 'join' })} disabled={s.readOnly} id="home-join">
                초대 코드로 참여
              </Btn>
            </div>
          </>
        )}
      </section>

      {ended.length > 0 ? (
        <section>
          <h2 className="sec-title">종료된 스터디</h2>
          <ul className="list card flush">
            {ended.map((r) => (
              <li key={r.sid}>
                <button type="button" className="list-row as-btn" onClick={() => go({ name: 'study', sid: r.sid, tab: 'stats' })}>
                  <span className="grow">
                    <span className="row-title">{r.study.name}</span>
                    <span className="row-sub">
                      {fmtDay(r.study.start, false)} ~ {r.study.end ? fmtDay(r.study.end, false) : '종료'}
                    </span>
                  </span>
                  <Icon name="right" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
