// 집중 모드: 공부하는 동안 타이머와 스터디 채팅만 남기고 다른 화면을 잠근다.

import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store';
import { elapsedSec, pauseSession, resumeSession } from '../actions';
import { isStudying, myStudies, unreadCount } from '../derive';
import { activeMemberIds } from '../logic';
import { fmtTimer } from '../time';
import type { Uid } from '../types';
import { Chat } from './chat';
import { Avatar, Btn, Icon, useNow } from './kit';
import { Clock, finishSession } from './room';

interface WakeLockLike {
  release(): Promise<void>;
}

/** 공부하는 동안 화면이 꺼지지 않게 한다(지원하는 브라우저에서만). */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on) return;
    let lock: WakeLockLike | null = null;
    let alive = true;
    const req = async () => {
      try {
        const wl = (navigator as unknown as { wakeLock?: { request(type: 'screen'): Promise<WakeLockLike> } }).wakeLock;
        if (!wl || document.visibilityState !== 'visible') return;
        const l = await wl.request('screen');
        if (alive) lock = l;
        else l.release().catch(() => undefined);
      } catch {
        /* 권한이 없으면 그냥 넘어간다 */
      }
    };
    req();
    const vis = () => {
      if (document.visibilityState === 'visible') req();
    };
    document.addEventListener('visibilitychange', vis);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', vis);
      lock?.release().catch(() => undefined);
    };
  }, [on]);
}

export function FocusScreen() {
  const s = useApp((x) => x);
  const session = s.session;
  const now = useNow(15000);
  const [asking, setAsking] = useState(false);
  const rooms = useMemo(() => myStudies(s).filter((r) => !r.ended), [s.studies, s.uid, s.today]); // eslint-disable-line react-hooks/exhaustive-deps
  const [picked, setPicked] = useState<string | null>(null);
  const sid = picked && rooms.some((r) => r.sid === picked) ? picked : (rooms.find((r) => unreadCount(s, r.sid) > 0)?.sid ?? rooms[0]?.sid ?? null);
  useWakeLock(!!session?.running);

  const friends = useMemo(() => {
    const set = new Set<Uid>();
    for (const r of rooms) for (const u of activeMemberIds(r.study)) if (u !== s.uid && !s.settings.blocks[u] && isStudying(s, u, now)) set.add(u);
    return [...set];
  }, [rooms, s.presence, s.settings.blocks, now]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session) return null;
  const sec = elapsedSec(session, Date.now());

  return (
    <div className="focus">
      <section className={'focus-main' + (session.running ? '' : ' paused')} aria-label="집중 모드 타이머">
        <p className="focus-badge">
          <Icon name="lock" size={14} />
          <span>집중 모드 · 채팅을 뺀 화면은 잠겨 있어요</span>
        </p>
        {session.subject ? <p className="focus-subject">{session.subject}</p> : null}
        <Clock session={session} className="big" />
        <p className="focus-state">{session.running ? '공부 중' : '잠시 멈춤'}</p>
        {asking ? (
          <div className="focus-ask" role="alertdialog" aria-label="공부 끝내기 확인">
            <p>{sec < 60 ? '아직 1분이 안 됐어요. 지금 끝내면 기록 없이 끝나요.' : `${fmtTimer(sec)} 공부했어요. 끝내고 인증할까요?`}</p>
            <div className="row gap center">
              <Btn kind="line" onClick={() => setAsking(false)} id="focus-keep">
                계속 공부
              </Btn>
              <Btn
                kind="danger"
                onClick={() => {
                  setAsking(false);
                  finishSession();
                }}
                id="focus-end-ok"
              >
                끝내기
              </Btn>
            </div>
          </div>
        ) : (
          <div className="row gap center">
            {session.running ? (
              <Btn kind="soft" size="lg" icon="pause" onClick={pauseSession} id="focus-pause">
                일시정지
              </Btn>
            ) : (
              <Btn kind="soft" size="lg" icon="play" onClick={resumeSession} id="focus-resume">
                계속
              </Btn>
            )}
            <Btn size="lg" icon="stop" onClick={() => setAsking(true)} id="focus-end">
              공부 끝내기
            </Btn>
          </div>
        )}
        {friends.length > 0 ? (
          <div className="focus-friends">
            <span className="av-stack">
              {friends.slice(0, 6).map((u) => (
                <span key={u} className="av-wrap sm live">
                  <Avatar uid={u} size={26} />
                </span>
              ))}
            </span>
            <span className="tiny">친구 {friends.length}명도 지금 공부 중</span>
          </div>
        ) : null}
      </section>

      <section className="focus-chat" aria-label="스터디 채팅">
        <div className="focus-chat-head">
          <Icon name="chat" size={16} />
          {rooms.length > 1 && sid ? (
            <select id="focus-room" className="input sm" value={sid} onChange={(e) => setPicked(e.target.value)} aria-label="채팅방 고르기">
              {rooms.map((r) => {
                const n = r.sid === sid ? 0 : unreadCount(s, r.sid);
                return (
                  <option key={r.sid} value={r.sid}>
                    {r.study.name}
                    {n > 0 ? ` (새 메시지 ${n > 99 ? '99+' : n})` : ''}
                  </option>
                );
              })}
            </select>
          ) : (
            <span className="row-title">{sid ? rooms[0]?.study.name : '스터디 채팅'}</span>
          )}
        </div>
        {sid ? <Chat key={sid} sid={sid} compact /> : <p className="center faint pad">참여 중인 스터디가 없어서 채팅방이 아직 없어요.</p>}
      </section>
    </div>
  );
}
