// 알림: 지난 일주일 동안의 소식.

import React, { useEffect, useMemo, useRef } from 'react';
import { useApp } from '../store';
import { markSeen } from '../actions';
import { buildNotifs, type Notif } from '../derive';
import { fmtAgo } from '../time';
import { back, go, openSheet } from '../ui';
import { Avatar, Btn, Empty, Icon, useNow } from './kit';

const KIND_ICON: Record<Notif['kind'], string> = { checkin: 'camera', react: 'fire', comment: 'chat', poke: 'poke', weekly: 'chart', remind: 'bell' };

export function NotifsPage() {
  const s = useApp((x) => x);
  const now = useNow(30000);
  const list = useMemo(() => buildNotifs(s, now), [s.checkins, s.pokes, s.studies, s.settings, s.profiles, s.today, now]); // eslint-disable-line react-hooks/exhaustive-deps
  // 들어왔을 때 기준으로 "새 소식" 표시를 유지한다
  const seenAt = useRef(s.settings.seenAt).current;

  useEffect(() => {
    const t = setTimeout(() => markSeen(), 500);
    return () => {
      clearTimeout(t);
      markSeen();
    };
  }, []);

  const open = (n: Notif) => {
    if (n.kind === 'remind') {
      openSheet({ kind: 'checkin' });
      return;
    }
    if (n.cid && s.checkins[n.cid]) {
      openSheet({ kind: 'checkinDetail', cid: n.cid });
      return;
    }
    if (n.route) go(n.route);
  };

  return (
    <div className="page">
      <div className="study-head">
        <Btn kind="ghost" size="sm" icon="left" onClick={back} label="뒤로" />
        <div className="grow">
          <h1 className="study-name">알림</h1>
          <p className="faint tiny">지난 일주일 동안의 소식이에요</p>
        </div>
        <Btn kind="ghost" size="sm" icon="gear" onClick={() => openSheet({ kind: 'notifSettings' })} label="알림 설정" id="notif-settings" />
      </div>
      {list.length === 0 ? (
        <Empty icon="bell" title="아직 소식이 없어요" body="친구가 인증을 올리거나 내 인증에 반응하면 여기에 모여요." />
      ) : (
        <ul className="list card flush">
          {list.map((n) => (
            <li key={n.id}>
              <button type="button" className={'list-row as-btn notif' + (n.at > seenAt ? ' fresh' : '')} onClick={() => open(n)}>
                {n.uid ? (
                  <Avatar uid={n.uid} size={36} />
                ) : (
                  <span className="notif-icon">
                    <Icon name={KIND_ICON[n.kind]} size={18} />
                  </span>
                )}
                <span className="grow">
                  <span className="row-title">{n.text}</span>
                  {n.sub ? <span className="row-sub">{n.sub}</span> : null}
                </span>
                <span className="row-end">
                  <span className="faint tiny">{fmtAgo(n.at, now)}</span>
                  {n.at > seenAt ? <span className="dot-new" aria-label="새 소식" /> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
