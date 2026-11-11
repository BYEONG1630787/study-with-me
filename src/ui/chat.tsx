// 스터디 채팅. 집중 모드에서도 이 부품만은 열려 있다.

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ensureChatSub, useApp, type MsgRow } from '../store';
import { deleteMessage, errText, markChatRead, reportMessage, sendMessage } from '../actions';
import { nickOf, unreadCount } from '../derive';
import { isActiveMember, isEnded, isHiddenByReports } from '../logic';
import { addDays, calDayOf, fmtClock, fmtDay, fmtMin } from '../time';
import type { Uid } from '../types';
import { go, openSheet, toast, type MenuItem } from '../ui';
import { confirmReport, userMenuItems } from './feed';
import { Avatar, Btn, Empty, Icon, Nick, copyText, useAsync, useNow } from './kit';
import { myStudies } from '../derive';

type Item =
  | { kind: 'day'; key: string; day: string }
  | { kind: 'msg'; key: string; row: MsgRow; head: boolean; hidden: boolean }
  | { kind: 'sys'; key: string; at: number; uid: Uid; cid: string; min: number };

export function Chat({ sid, compact }: { sid: string; compact?: boolean }) {
  const rows = useApp((s) => s.messages[sid]);
  const uid = useApp((s) => s.uid);
  const blocks = useApp((s) => s.settings.blocks);
  const study = useApp((s) => s.studies[sid]);
  const today = useApp((s) => s.today);
  const checkins = useApp((s) => s.checkins);
  const readOnly = useApp((s) => s.readOnly);
  // 대화의 날짜 구분선은 달력 날짜(자정 기준)로 긋는다
  const calToday = calDayOf(useNow(30000));
  const [text, setText] = useState('');
  const [, run] = useAsync();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  useEffect(() => {
    ensureChatSub(sid);
  }, [sid]);

  const items = useMemo(() => {
    const list: { at: number; item: Item }[] = [];
    const msgs = (rows ?? []).filter((r) => !blocks[r.u]);
    const floor = rows && rows.length >= 150 ? rows[0].at : 0;
    for (const r of msgs) list.push({ at: r.at, item: { kind: 'msg', key: r.id, row: r, head: true, hidden: isHiddenByReports(r.rep) } });
    for (const id of Object.keys(checkins)) {
      const c = checkins[id];
      if (!c.sids.includes(sid) || blocks[c.uid] || c.at < floor || isHiddenByReports(c.rep)) continue;
      list.push({ at: c.at, item: { kind: 'sys', key: 'ci-' + id, at: c.at, uid: c.uid, cid: id, min: c.min } });
    }
    list.sort((a, b) => a.at - b.at);
    const out: Item[] = [];
    let lastDay = '';
    let prev: Item | null = null;
    for (const { at, item } of list) {
      const d = calDayOf(at);
      if (d !== lastDay) {
        out.push({ kind: 'day', key: 'd-' + d, day: d });
        lastDay = d;
        prev = null;
      }
      if (item.kind === 'msg' && prev && prev.kind === 'msg' && prev.row.u === item.row.u && item.row.at - prev.row.at < 180e3) item.head = false;
      out.push(item);
      prev = item;
    }
    return out;
  }, [rows, checkins, blocks, sid]);

  const lastKey = items.length ? items[items.length - 1].key : '';
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lastKey, items.length]);

  useEffect(() => {
    if (rows && rows.length && document.visibilityState !== 'hidden') markChatRead(sid);
  }, [rows, sid]);

  // 다른 탭에 있다가 돌아왔을 때도 읽음으로 표시한다
  useEffect(() => {
    const vis = () => {
      if (document.visibilityState !== 'hidden') markChatRead(sid);
    };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, [sid]);

  if (!study) return null;
  const ended = isEnded(study, today);
  const member = isActiveMember(study, uid);
  const canSend = member && !ended && !readOnly;

  // 앞 메시지가 저장되기를 기다리지 않고 이어서 보낼 수 있다
  const send = () => {
    const t = text.trim();
    if (!t) return;
    stick.current = true;
    setText('');
    if (inputRef.current) inputRef.current.style.height = '';
    sendMessage(sid, t).catch((e) => {
      setText((cur) => cur || t);
      toast(errText(e), 'err');
    });
  };

  const menuFor = (r: MsgRow) => {
    const items2: MenuItem[] = [
      {
        label: '복사',
        run: async () => {
          toast((await copyText(r.t)) ? '복사했어요' : '복사하지 못했어요', 'info');
        },
      },
    ];
    if (r.u === uid) items2.push({ label: '메시지 삭제', danger: true, run: () => run(() => deleteMessage(sid, r.id)) });
    else {
      items2.push({ label: '메시지 신고', run: () => confirmReport('이 메시지를 신고할까요?', () => reportMessage(sid, r.id)) });
      items2.push(...userMenuItems(r.u));
    }
    openSheet({ kind: 'menu', items: items2 });
  };

  return (
    <div className={'chat' + (compact ? ' compact' : '')}>
      <div
        className="chat-list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        aria-live="polite"
      >
        {rows === undefined ? <p className="center faint pad">대화를 불러오는 중…</p> : null}
        {rows !== undefined && items.length === 0 ? <Empty icon="chat" title="아직 대화가 없어요" body="첫 메시지를 보내 보세요. 인증이 올라오면 여기에도 소식이 떠요." /> : null}
        {items.map((it) => {
          if (it.kind === 'day')
            return (
              <div key={it.key} className="chat-day">
                <span>{it.day === calToday ? '오늘' : it.day === addDays(calToday, -1) ? '어제' : fmtDay(it.day)}</span>
              </div>
            );
          if (it.kind === 'sys') {
            const line = (
              <>
                <Icon name="camera" size={14} />
                <span>
                  <Nick uid={it.uid} />
                  님이 {fmtMin(it.min)} 인증을 올렸어요
                </span>
              </>
            );
            // 집중 모드에서는 인증 상세(피드)가 잠겨 있으므로 소식만 보여 준다
            return compact ? (
              <div key={it.key} className="msg-sys">
                {line}
              </div>
            ) : (
              <button key={it.key} type="button" className="msg-sys" onClick={() => openSheet({ kind: 'checkinDetail', cid: it.cid })}>
                {line}
              </button>
            );
          }
          const mine = it.row.u === uid;
          return (
            <div key={it.key} className={'msg' + (mine ? ' me' : '') + (it.head ? ' head' : '')}>
              {!mine ? <div className="msg-av">{it.head ? <Avatar uid={it.row.u} size={30} /> : null}</div> : null}
              <div className="msg-col">
                {!mine && it.head ? (
                  <span className="msg-name">
                    <Nick uid={it.row.u} />
                  </span>
                ) : null}
                <div className="msg-line">
                  {it.hidden ? (
                    <span className="bubble hidden">신고로 가려진 메시지</span>
                  ) : (
                    <button type="button" className="bubble" onClick={() => menuFor(it.row)} aria-label="메시지 메뉴 열기">
                      {it.row.t}
                    </button>
                  )}
                  <span className="msg-time faint">{fmtClock(it.row.at)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {canSend ? (
        <form
          className="chat-input"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            id={'chat-input-' + sid}
            ref={inputRef}
            className="input"
            rows={1}
            maxLength={500}
            value={text}
            placeholder="메시지 보내기"
            aria-label="메시지"
            onChange={(e) => {
              setText(e.target.value);
              const el = e.currentTarget;
              el.style.height = '';
              el.style.height = Math.min(el.scrollHeight, 104) + 'px';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !touch && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          <Btn type="submit" icon="send" disabled={!text.trim()} label="보내기" />
        </form>
      ) : (
        <p className="chat-closed faint">{ended ? '종료된 스터디라 새 메시지를 보낼 수 없어요.' : readOnly ? '보기 전용으로 열려 있어요.' : '스터디 멤버만 채팅할 수 있어요.'}</p>
      )}
    </div>
  );
}

/** 채팅 탭: 내 스터디 채팅방 목록 */
export function ChatsPage() {
  const s = useApp((x) => x);
  const rows = myStudies(s);
  return (
    <div className="page">
      <h1 className="page-title">채팅</h1>
      {rows.length === 0 ? (
        <Empty icon="chat" title="채팅방이 아직 없어요" body="스터디를 만들거나 참여하면 스터디마다 채팅방이 하나씩 생겨요." />
      ) : (
        <ul className="list card flush">
          {rows.map((r) => {
            const msgs = (s.messages[r.sid] ?? []).filter((m) => !s.settings.blocks[m.u] && !isHiddenByReports(m.rep));
            const last = msgs[msgs.length - 1];
            const unread = unreadCount(s, r.sid);
            return (
              <li key={r.sid}>
                <button type="button" className="list-row as-btn" onClick={() => go({ name: 'study', sid: r.sid, tab: 'chat' })}>
                  <span className="room-mark" aria-hidden="true">
                    {Array.from(r.study.name)[0]}
                  </span>
                  <span className="grow">
                    <span className="row-title">
                      {r.study.name}
                      {r.ended ? <span className="chip mute sm">종료</span> : null}
                    </span>
                    <span className="row-sub">{last ? `${nickOf(s.profiles, last.u)}: ${last.t}` : '아직 대화가 없어요'}</span>
                  </span>
                  <span className="row-end">
                    {last ? <span className="faint tiny">{fmtClock(last.at)}</span> : null}
                    {unread > 0 ? <span className="badge">{unread > 99 ? '99+' : unread}</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
