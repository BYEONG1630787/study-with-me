// 시트 모음: 스터디 만들기·수정, 참여, 초대, 공부 시작, 프로필, 확인, 메뉴, 알림 설정, 차단, 안내, 벌금.

import React, { useRef, useState } from 'react';
import { useApp } from '../store';
import { checkJoin, createStudy, errText, joinStudy, normalizeCode, patchSettings, saveProfile, setBlocked, setFine, startSession, updateStudy, type StudyForm } from '../actions';
import { subjectHints } from '../derive';
import { APP_URL } from '../env';
import { activeMemberIds, isEnded, notStarted, pendingRule, ruleForWeek } from '../logic';
import { prepareAvatar } from '../media';
import { addDays, fmtDay, fmtMin, fmtShort, weekStart } from '../time';
import type { NotifSettings } from '../types';
import { closeAllSheets, closeSheet, go, goTab, openSheet, toast, type MenuItem } from '../ui';
import { Avatar, Btn, CopyBox, Field, Icon, Nick, SheetFrame, Toggle, useAsync } from './kit';
import { ruleText, won } from './study';

const DAILY_OPTIONS = [0, 30, 60, 90, 120, 150, 180, 240, 300, 360, 480, 600, 720];

// ------------------------------------------------------------------ 스터디 만들기·수정

export function StudyFormSheet({ sid }: { sid?: string }) {
  const today = useApp((s) => s.today);
  const study = useApp((s) => (sid ? s.studies[sid] : undefined));
  const shown = study ? (pendingRule(study, today) ?? ruleForWeek(study, weekStart(today))) : null;
  const [name, setName] = useState(study?.name ?? '');
  const [intro, setIntro] = useState(study?.intro ?? '');
  const [start, setStart] = useState(study?.start ?? today);
  const [end, setEnd] = useState(study?.end ?? '');
  const [max, setMax] = useState(study?.max ?? 6);
  const [weekly, setWeekly] = useState(shown?.weekly ?? 5);
  const [dailyMin, setDailyMin] = useState(shown?.dailyMin ?? 60);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const editing = !!sid;
  const started = study ? !notStarted(study, today) : false;
  const members = study ? activeMemberIds(study).length : 1;
  const ruleChanged = !!shown && (shown.weekly !== weekly || shown.dailyMin !== dailyMin);

  const submit = async () => {
    if (busy) return;
    setErr(null);
    setBusy(true);
    const form: StudyForm = { name, intro, start, end: end || null, max, weekly, dailyMin };
    try {
      if (sid) {
        await updateStudy(sid, form);
        toast('스터디를 고쳤어요', 'ok');
        closeSheet();
      } else {
        const id = await createStudy(form);
        closeSheet();
        go({ name: 'study', sid: id, tab: 'today' });
        openSheet({ kind: 'invite', sid: id });
      }
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };

  return (
    <SheetFrame
      title={editing ? '스터디 수정' : '스터디 만들기'}
      onClose={closeSheet}
      footer={
        <>
          {err ? (
            <p className="error-text" role="alert">
              {err}
            </p>
          ) : null}
          <Btn block size="lg" busy={busy} disabled={!name.trim()} onClick={submit} id="st-submit">
            {editing ? '저장' : '스터디 만들기'}
          </Btn>
        </>
      }
    >
      <form
        className="col gap-lg"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="스터디 이름" htmlFor="st-name" hint={`${name.length}/20`}>
          <input id="st-name" className="input" value={name} maxLength={20} placeholder="예: 아침 공부 인증방" onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="소개" htmlFor="st-intro" hint={`선택 · ${intro.length}/100`}>
          <textarea id="st-intro" className="input" rows={2} maxLength={100} value={intro} placeholder="어떤 스터디인지 한두 줄로 적어 주세요" onChange={(e) => setIntro(e.target.value)} />
        </Field>
        <div className="row gap">
          <Field label="시작일" htmlFor="st-start" hint={editing ? '시작일은 바꿀 수 없어요' : undefined}>
            <input id="st-start" className="input" type="date" value={start} disabled={editing} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="종료일" htmlFor="st-end" hint="비워 두면 계속 이어져요">
            <input id="st-end" className="input" type="date" value={end} min={start > today ? start : today} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <div className="field">
          <span className="label" id="st-weekly-label">
            주당 목표 횟수
          </span>
          <div className="chips-wrap" role="group" aria-labelledby="st-weekly-label">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <button key={n} type="button" id={'st-weekly-' + n} className={'chip pick lg' + (weekly === n ? ' on' : '')} aria-pressed={weekly === n} onClick={() => setWeekly(n)}>
                {n === 7 ? '매일' : `주 ${n}회`}
              </button>
            ))}
          </div>
        </div>
        <div className="row gap">
          <Field label="하루 최소 공부 시간" htmlFor="st-daily" hint="이 시간을 채운 날만 인증한 날로 세요">
            <select id="st-daily" className="input" value={dailyMin} onChange={(e) => setDailyMin(Number(e.target.value))}>
              {DAILY_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? '없음 (올리기만 하면 인정)' : fmtMin(m)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="최대 인원" htmlFor="st-max" hint="2~10명">
            <select id="st-max" className="input" value={max} onChange={(e) => setMax(Number(e.target.value))}>
              {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n} disabled={n < members}>
                  {n}명
                </option>
              ))}
            </select>
          </Field>
        </div>
        {editing && started && ruleChanged ? <p className="note">바꾼 규칙은 다음 주 월요일({fmtShort(addDays(weekStart(today), 7))})부터 적용돼요. 이번 주 달성 여부는 지금 규칙으로 계산해요.</p> : null}
        {!editing ? <p className="hint">하루는 새벽 4시에 바뀌고, 한 주는 월요일에 시작해요. 만든 뒤에 초대 코드로 친구를 부를 수 있어요.</p> : null}
      </form>
    </SheetFrame>
  );
}

// ------------------------------------------------------------------ 참여

export function JoinSheet({ code }: { code?: string }) {
  const [val, setVal] = useState(normalizeCode(code ?? ''));
  const loaded = useApp((s) => s.studiesLoaded);
  const today = useApp((s) => s.today);
  // 스터디 목록이 바뀌면 다시 확인하도록 구독한다
  useApp((s) => s.studies);
  const [busy, run] = useAsync();
  const chk = val.length === 6 ? checkJoin(val) : null;
  const st = chk?.study;

  const join = () =>
    run(async () => {
      const sid = await joinStudy(val);
      closeSheet();
      go({ name: 'study', sid, tab: 'today' });
      toast('스터디에 참여했어요', 'ok');
    });

  return (
    <SheetFrame
      title="초대 코드로 참여"
      onClose={closeSheet}
      footer={
        chk && chk.already ? (
          <Btn
            block
            size="lg"
            kind="soft"
            onClick={() => {
              closeSheet();
              go({ name: 'study', sid: chk.sid, tab: 'today' });
            }}
          >
            스터디로 가기
          </Btn>
        ) : (
          <Btn block size="lg" busy={busy} disabled={!chk || !!chk.error} onClick={join} id="join-submit">
            참여하기
          </Btn>
        )
      }
    >
      <form
        className="col gap-lg"
        onSubmit={(e) => {
          e.preventDefault();
          if (chk && !chk.error && !chk.already) join();
        }}
      >
        <Field label="초대 코드" htmlFor="join-code" hint="친구에게 받은 6자리 코드를 적어 주세요">
          <input
            id="join-code"
            className="input code-input num"
            value={val}
            maxLength={6}
            placeholder="ABC234"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            onChange={(e) => setVal(normalizeCode(e.target.value))}
          />
        </Field>
        {val.length === 6 && !chk ? (
          <p className="error-text" role="alert">
            {loaded ? '이 코드로는 스터디를 찾을 수 없어요. 방장이 코드를 다시 발급했다면 새 코드가 필요해요.' : '스터디를 확인하는 중…'}
          </p>
        ) : null}
        {chk && st ? (
          <div className="card col gap join-preview">
            <p className="row-title">{st.name}</p>
            {st.intro ? <p className="muted">{st.intro}</p> : null}
            <dl className="kv">
              <dt>인원</dt>
              <dd>
                {activeMemberIds(st).length} / {st.max}명
              </dd>
              <dt>규칙</dt>
              <dd>{ruleText(pendingRule(st, today) ?? ruleForWeek(st, weekStart(today)))}</dd>
              <dt>기간</dt>
              <dd>
                {fmtDay(st.start)} ~ {st.end ? fmtDay(st.end) : '종료일 없음'}
              </dd>
              {st.fineAmount ? (
                <>
                  <dt>벌금</dt>
                  <dd>주간 목표 미달성 1회당 {won(st.fineAmount)}</dd>
                </>
              ) : null}
            </dl>
            {chk.already ? <p className="note">이미 참여 중인 스터디예요.</p> : null}
            {chk.error ? (
              <p className="error-text" role="alert">
                {chk.error}
              </p>
            ) : null}
          </div>
        ) : null}
      </form>
    </SheetFrame>
  );
}

// ------------------------------------------------------------------ 초대

export function inviteLink(code: string): string {
  return APP_URL ? `${APP_URL}#join-${code.toLowerCase()}` : '';
}

export function InviteSheet({ sid }: { sid: string }) {
  const study = useApp((s) => s.studies[sid]);
  const mode = useApp((s) => s.mode);
  const host = useApp((s) => s.host);
  const today = useApp((s) => s.today);
  if (!study) return null;
  const link = inviteLink(study.code);
  const full = activeMemberIds(study).length >= study.max;
  const msg = `[스터디 윗미] '${study.name}' 스터디에 초대해요.\n초대 코드: ${study.code}` + (link ? `\n${link}` : '');
  return (
    <SheetFrame title="친구 초대" onClose={closeSheet}>
      <div className="col gap-lg">
        <div className="invite-code">
          <span className="label">초대 코드</span>
          <span className="code-big num" id="invite-code">
            {study.code}
          </span>
          <span className="faint tiny">
            {study.name} · {activeMemberIds(study).length}/{study.max}명
          </span>
        </div>
        {isEnded(study, today) ? <p className="note">종료된 스터디라 새로 참여할 수 없어요.</p> : null}
        {full ? <p className="note">정원이 가득 찼어요. 방장이 최대 인원을 늘리면 더 초대할 수 있어요.</p> : null}
        <div className="field">
          <span className="label">초대 메시지</span>
          <CopyBox id="invite-msg" text={msg} label="메시지 복사" />
        </div>
        {link ? (
          <div className="field">
            <span className="label">초대 링크</span>
            <CopyBox id="invite-link" text={link} label="링크 복사" />
          </div>
        ) : null}
        {host === 'firebase' ? (
          <p className="note">초대 링크나 메시지를 친구에게 보내 주세요. 친구가 링크를 열어 회원가입하고 닉네임을 만들면 바로 이 스터디에 들어와요.</p>
        ) : mode === 'cloud' ? (
          <div className="note col gap-sm">
            <p>
              <b>친구가 인증을 올리려면</b> 이 페이지의 주인이 공유 메뉴에서 친구의 이메일을 <b>편집자</b>로 초대해야 해요. 링크만 받은 사람은 보기만 할 수 있고, 공개 링크 공유가 켜져 있어도 보기만 할 수 있어요.
            </p>
            <button type="button" className="text-btn" onClick={() => openSheet({ kind: 'help' })}>
              초대 방법 자세히 보기
            </button>
          </div>
        ) : (
          <p className="note">지금은 이 기기에만 저장하는 체험 모드라서 친구가 들어올 수 없어요. 친구와 함께 쓰려면 claude.ai에서 이 페이지를 열어 주세요.</p>
        )}
      </div>
    </SheetFrame>
  );
}

// ------------------------------------------------------------------ 공부 시작(집중 모드)

export function StartFocusSheet() {
  const s = useApp((x) => x);
  const [subject, setSubject] = useState(s.pending?.subject ?? '');
  const hints = subjectHints(s);
  const inRoom = s.session?.mode === 'room';

  const start = () => {
    try {
      startSession('focus', subject);
      closeAllSheets();
    } catch (e) {
      toast(errText(e), 'err');
    }
  };

  if (inRoom) {
    return (
      <SheetFrame title="공부 시작" onClose={closeSheet}>
        <div className="col gap-lg">
          <p className="muted">학습장에서 이미 공부 시간을 재고 있어요. 집중 모드로 바꾸려면 학습장에서 학습을 먼저 종료해 주세요.</p>
          <Btn
            block
            kind="soft"
            icon="book"
            onClick={() => {
              closeSheet();
              goTab('room');
            }}
          >
            학습장으로 가기
          </Btn>
        </div>
      </SheetFrame>
    );
  }

  return (
    <SheetFrame
      title="공부 시작"
      onClose={closeSheet}
      footer={
        <Btn block size="lg" icon="lock" onClick={start} id="focus-start">
          집중 모드로 시작
        </Btn>
      }
    >
      <form
        className="col gap-lg"
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
      >
        <Field label="과목" htmlFor="focus-subject" hint="선택 · 친구들에게 '공부 중'과 함께 보여요">
          <input id="focus-subject" className="input" value={subject} maxLength={20} list="focus-subject-list" placeholder="예: 영어, 자료구조" onChange={(e) => setSubject(e.target.value)} autoComplete="off" />
          <datalist id="focus-subject-list">
            {hints.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </Field>
        <ul className="bullets">
          <li>
            <Icon name="timer" size={18} />
            <span>타이머가 돌기 시작하고, 끝내면 잰 시간으로 바로 인증할 수 있어요.</span>
          </li>
          <li>
            <Icon name="lock" size={18} />
            <span>공부하는 동안 피드, 통계, 학습장 같은 다른 화면은 잠겨요.</span>
          </li>
          <li>
            <Icon name="chat" size={18} />
            <span>스터디 채팅은 잠기지 않고 계속 보여요.</span>
          </li>
        </ul>
        {s.pending ? <p className="note">아직 인증하지 않은 공부 {fmtMin(Math.floor(s.pending.sec / 60))}이 있어요. 이어서 공부하면 시간을 합쳐서 인증할 수 있어요.</p> : null}
        <button
          type="button"
          className="text-btn"
          onClick={() => {
            closeSheet();
            goTab('room');
          }}
        >
          자료를 보면서 공부하려면 학습장으로 (잠기지 않아요)
        </button>
      </form>
    </SheetFrame>
  );
}

// ------------------------------------------------------------------ 프로필

export function ProfileFields(props: { nick: string; setNick: (v: string) => void; color: number; setColor: (v: number) => void; photo: string | null; setPhoto: (v: string | null) => void }) {
  const { nick, setNick, color, setColor, photo, setPhoto } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setReading(true);
    try {
      setPhoto(await prepareAvatar(f));
    } catch {
      toast('사진을 읽지 못했어요. JPG나 PNG 사진으로 다시 시도해 주세요.', 'err');
    } finally {
      setReading(false);
    }
  };
  const initial = Array.from(nick.trim())[0] ?? '?';
  return (
    <>
      <div className="profile-pick">
        {photo ? (
          <img className="avatar" style={{ width: 76, height: 76 }} src={photo} alt="프로필 사진" />
        ) : (
          <span className={'avatar av-' + (color % 8)} style={{ width: 76, height: 76, fontSize: 32 }} aria-hidden="true">
            {initial}
          </span>
        )}
        <div className="col gap-sm">
          <div className="row gap wrap">
            <Btn kind="soft" size="sm" icon="image" busy={reading} onClick={() => fileRef.current?.click()}>
              사진 고르기
            </Btn>
            {photo ? (
              <Btn kind="ghost" size="sm" onClick={() => setPhoto(null)}>
                사진 빼기
              </Btn>
            ) : null}
          </div>
          <div className="swatches" role="group" aria-label="프로필 색">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
              <button key={n} type="button" className={'swatch av-' + n + (color === n ? ' on' : '')} aria-pressed={color === n} aria-label={`색 ${n + 1}`} onClick={() => setColor(n)} />
            ))}
          </div>
        </div>
        <input ref={fileRef} id="pf-photo" type="file" accept="image/*" hidden onChange={pick} />
      </div>
      <Field label="닉네임" htmlFor="pf-nick" hint={`2~12자 · ${Array.from(nick.trim()).length}/12`}>
        <input id="pf-nick" className="input" value={nick} maxLength={12} placeholder="친구들이 알아볼 이름" onChange={(e) => setNick(e.target.value)} autoComplete="off" />
      </Field>
    </>
  );
}

export function ProfileSheet() {
  const me = useApp((s) => s.profiles[s.uid]);
  const [nick, setNick] = useState(me?.nick ?? '');
  const [color, setColor] = useState(me?.color ?? 0);
  const [photo, setPhoto] = useState<string | null>(me?.photo ?? null);
  const [busy, run] = useAsync();
  const save = () =>
    run(async () => {
      const el = document.getElementById('pf-nick') as HTMLInputElement | null;
      await saveProfile({ nick: el ? el.value : nick, color, photo });
      closeSheet();
    }, '프로필을 저장했어요');
  return (
    <SheetFrame
      title="프로필 수정"
      onClose={closeSheet}
      footer={
        <Btn block size="lg" busy={busy} onClick={save} id="pf-save">
          저장
        </Btn>
      }
    >
      <form
        className="col gap-lg"
        onSubmit={(e) => {
          e.preventDefault();
          if (!(e.nativeEvent as unknown as { isComposing?: boolean }).isComposing) save();
        }}
      >
        <ProfileFields nick={nick} setNick={setNick} color={color} setColor={setColor} photo={photo} setPhoto={setPhoto} />
      </form>
    </SheetFrame>
  );
}

// ------------------------------------------------------------------ 확인·메뉴

export function ConfirmSheet(props: { title: string; body?: string; okLabel: string; danger?: boolean; onOk: () => unknown }) {
  const { title, body, okLabel, danger, onOk } = props;
  return (
    <SheetFrame onClose={closeSheet}>
      <div className="confirm" role="alertdialog" aria-label={title}>
        <h2 className="confirm-title">{title}</h2>
        {body ? <p className="muted">{body}</p> : null}
        <div className="confirm-actions">
          <Btn kind="line" onClick={closeSheet} id="confirm-cancel">
            취소
          </Btn>
          <Btn
            kind={danger ? 'danger' : 'primary'}
            id="confirm-ok"
            onClick={() => {
              closeSheet();
              Promise.resolve()
                .then(onOk)
                .catch((e) => toast(errText(e), 'err'));
            }}
          >
            {okLabel}
          </Btn>
        </div>
      </div>
    </SheetFrame>
  );
}

export function MenuSheet({ title, items }: { title?: string; items: MenuItem[] }) {
  return (
    <SheetFrame onClose={closeSheet} title={title}>
      <ul className="menu">
        {items.map((it, i) => (
          <li key={i}>
            <button
              type="button"
              className={'menu-item' + (it.danger ? ' danger' : '')}
              onClick={() => {
                closeSheet();
                it.run();
              }}
            >
              {it.label}
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="menu-item faint" onClick={closeSheet}>
            닫기
          </button>
        </li>
      </ul>
    </SheetFrame>
  );
}

// ------------------------------------------------------------------ 알림 설정

export function NotifSettingsSheet() {
  const n = useApp((s) => s.settings.notif);
  const set = (patch: Partial<NotifSettings>) => patchSettings((s) => ({ ...s, notif: { ...s.notif, ...patch } }));
  return (
    <SheetFrame title="알림 설정" onClose={closeSheet}>
      <div className="col gap-lg">
        <p className="note">웹 버전은 이 페이지가 열려 있을 때 화면 안 알림으로 알려 줘요. 지나간 소식은 알림 화면에 모여 있어요.</p>
        <div className="toggles">
          <Toggle id="nt-remind" checked={n.remind} onChange={(v) => set({ remind: v })} label="인증 리마인더" sub="정한 시각까지 오늘 인증이 없으면 알려 줘요" />
          {n.remind ? (
            <div className="toggle-extra">
              <label className="label" htmlFor="nt-remind-at">
                알림 시각
              </label>
              <input id="nt-remind-at" className="input sm" type="time" value={n.remindAt} onChange={(e) => e.target.value && set({ remindAt: e.target.value })} />
            </div>
          ) : null}
          <Toggle id="nt-friend" checked={n.friend} onChange={(v) => set({ friend: v })} label="친구 인증" sub="같은 스터디 친구가 인증을 올렸을 때" />
          <Toggle id="nt-react" checked={n.react} onChange={(v) => set({ react: v })} label="반응·댓글" sub="내 인증에 반응이나 댓글이 달렸을 때" />
          <Toggle id="nt-poke" checked={n.poke} onChange={(v) => set({ poke: v })} label="콕 찌르기" sub="친구가 공부하자고 찔렀을 때" />
          <Toggle id="nt-chat" checked={n.chat} onChange={(v) => set({ chat: v })} label="채팅" sub="스터디 채팅에 새 메시지가 왔을 때" />
          <Toggle id="nt-weekly" checked={n.weekly} onChange={(v) => set({ weekly: v })} label="주간 결과" sub="월요일 오전에 지난주 달성 여부를 알려 줘요" />
          <Toggle id="nt-quiet" checked={n.quiet} onChange={(v) => set({ quiet: v })} label="밤에는 조용히" sub="밤 10시부터 오전 8시까지는 팝업을 띄우지 않아요" />
        </div>
      </div>
    </SheetFrame>
  );
}

// ------------------------------------------------------------------ 차단 목록

export function BlocksSheet() {
  const blocks = useApp((s) => s.settings.blocks);
  const ids = Object.keys(blocks).filter((u) => blocks[u]);
  return (
    <SheetFrame title="차단 목록" onClose={closeSheet}>
      {ids.length === 0 ? <p className="muted">차단한 사람이 없어요. 인증이나 채팅 메시지의 메뉴에서 차단할 수 있어요.</p> : null}
      <ul className="list">
        {ids.map((u) => (
          <li key={u} className="list-row">
            <Avatar uid={u} size={34} />
            <span className="grow">
              <Nick uid={u} />
            </span>
            <Btn
              kind="line"
              size="sm"
              onClick={() => {
                setBlocked(u, false);
                toast('차단을 풀었어요', 'ok');
              }}
            >
              차단 해제
            </Btn>
          </li>
        ))}
      </ul>
    </SheetFrame>
  );
}

// ------------------------------------------------------------------ 이용 규칙·개인정보

export function TermsSheet() {
  return (
    <SheetFrame title="이용 규칙과 개인정보 안내" onClose={closeSheet} wide>
      <div className="prose">
        <h3>이용 규칙</h3>
        <ul>
          <li>만 14세 이상만 사용할 수 있어요.</li>
          <li>인증 사진에는 본인이 공부한 모습이나 자료만 올려 주세요. 다른 사람의 얼굴, 연락처, 신분증 같은 개인정보가 담긴 사진은 올리지 않아요.</li>
          <li>욕설, 괴롭힘, 음란물, 광고는 금지예요. 신고가 3건 이상 쌓인 인증, 댓글, 메시지는 자동으로 가려져요.</li>
          <li>벌금은 앱이 장부로만 기록해요. 실제 돈 거래는 멤버끼리 직접 하고, 앱은 관여하지 않아요.</li>
        </ul>
        <h3>저장하는 정보</h3>
        <ul>
          <li>닉네임, 프로필 색과 사진</li>
          <li>인증(사진, 공부 시간, 과목, 메모), 반응, 댓글, 채팅 메시지</li>
          <li>공부 중 상태(시작 시각, 과목)와 콕 찌르기 기록</li>
          <li>나만 보는 정보: 알림 설정, 차단 목록, 학습장 자료</li>
        </ul>
        <h3>누가 볼 수 있나요</h3>
        <p>스터디 안의 인증과 채팅은 화면에서 그 스터디 멤버에게만 보여요. 다만 이 페이지를 열 수 있는 사람은 모두 같은 저장소를 함께 쓰기 때문에 완전한 비공개는 아니에요. 믿을 수 있는 친구에게만 페이지를 공유해 주세요.</p>
        <p>학습장 자료와 설정은 본인만 볼 수 있는 개인 영역이나 이 기기에 저장돼요.</p>
        <h3>사진</h3>
        <p>사진은 올리기 전에 기기에서 작게 줄이고, 그 과정에서 촬영 위치 같은 부가 정보가 지워져요.</p>
        <h3>지우기</h3>
        <ul>
          <li>인증은 올린 날 마감(새벽 4시) 전까지 직접 고치거나 지울 수 있어요. 댓글과 채팅 메시지는 언제든 지울 수 있어요.</li>
          <li>탈퇴하면 프로필이 지워지고 모든 스터디에서 나가요. 올렸던 인증은 '탈퇴한 사용자'의 기록으로 스터디 통계에 남아요.</li>
        </ul>
      </div>
    </SheetFrame>
  );
}

// ------------------------------------------------------------------ 도움말

export function HelpSheet() {
  const mode = useApp((s) => s.mode);
  const host = useApp((s) => s.host);
  const hasAccountId = useApp((s) => s.hasAccountId);
  const hasAssets = useApp((s) => s.hasAssets);
  return (
    <SheetFrame title="사용 안내" onClose={closeSheet} wide>
      <div className="prose">
        <h3>친구와 함께 쓰는 방법</h3>
        {host === 'firebase' ? (
          <ol>
            <li>스터디를 만들고 '친구 초대'에서 초대 링크를 복사해 친구에게 보내요.</li>
            <li>친구가 링크를 열어 회원가입하고 닉네임을 만들면 같은 스터디에 들어와요. 링크 대신 초대 코드 6자리를 '초대 코드로 참여'에 적어도 돼요.</li>
            <li>이메일과 비밀번호로 가입하면 휴대폰, 컴퓨터 어디서든 같은 계정으로 로그인해 이어서 쓸 수 있어요.</li>
          </ol>
        ) : (
        <ol>
          <li>
            이 페이지의 주인이 claude.ai 공유 메뉴에서 친구의 이메일을 <b>편집자</b>로 초대해요. 공개 링크 공유는 꺼 두세요. 켜 두면 초대받은 친구도 보기만 할 수 있어요. 편집자는 이 페이지 자체도 고칠 수 있는 권한이라, 믿을 수 있는 친구만 초대해 주세요.
          </li>
          <li>친구가 Claude 계정으로 페이지를 열고 닉네임을 만들어요.</li>
          <li>스터디의 초대 코드 6자리를 '초대 코드로 참여'에 적으면 같은 스터디에 들어와요.</li>
        </ol>
        )}
        <h3>인증</h3>
        <ul>
          <li>사진 1~3장과 공부 시간을 올리면 인증이에요. 타이머로 잰 공부는 사진 없이도 인증할 수 있어요.</li>
          <li>하루는 새벽 4시에 바뀌어요. 새벽 2시에 올린 인증은 전날 공부로 세요.</li>
          <li>한 주는 월요일에 시작해요. 스터디에서 정한 주당 횟수를 채우면 그 주는 달성이에요.</li>
        </ul>
        <h3>공부 시작 두 가지</h3>
        <ul>
          <li>
            <b>집중 모드</b>: 가운데 '공부 시작' 버튼. 타이머가 돌고, 채팅을 뺀 다른 화면이 잠겨요.
          </li>
          <li>
            <b>학습장</b>: PDF, HTML, 이미지, 글 자료를 넣어 두고 화면에서 보면서 공부해요. 타이머는 돌지만 화면은 잠기지 않아요.
          </li>
        </ul>
        <h3>지금 저장 방식</h3>
        <ul>
          <li>{mode === 'cloud' ? '함께 쓰는 저장소에 연결돼 있어요. 친구들과 기록이 실시간으로 맞춰져요.' : '체험 모드예요. 기록이 이 기기의 브라우저에만 저장되고 친구와 공유되지 않아요.'}</li>
          {mode === 'cloud' ? <li>{hasAccountId ? '설정과 학습장 자료 목록은 내 계정의 개인 영역에 저장돼요.' : '계정 정보를 받지 못해 이 기기를 기준으로 사용자를 구분해요. 다른 기기에서 열면 새 사용자로 보일 수 있어요.'}</li> : null}
          <li>{hasAssets ? '학습장 자료 파일과 인증 사진 원본은 페이지의 파일 저장소에 올라가요.' : '학습장 자료 파일은 이 기기에만 저장돼요. 다른 기기에서는 다시 넣어야 해요.'}</li>
        </ul>
      </div>
    </SheetFrame>
  );
}

// ------------------------------------------------------------------ 벌금 설정

export function FineSheet({ sid }: { sid: string }) {
  const study = useApp((s) => s.studies[sid]);
  const [val, setVal] = useState(String(study?.fineAmount || ''));
  const [busy, run] = useAsync();
  if (!study) return null;
  const amount = Number(val) || 0;
  const valid = amount >= 0 && amount <= 1000000 && amount % 100 === 0;
  const save = () =>
    run(async () => {
      await setFine(sid, amount);
      closeSheet();
    }, amount > 0 ? '벌금 규칙을 저장했어요' : '벌금 규칙을 껐어요');
  return (
    <SheetFrame
      title="벌금 설정"
      onClose={closeSheet}
      footer={
        <Btn block size="lg" busy={busy} disabled={!valid} onClick={save} id="fine-save">
          저장
        </Btn>
      }
    >
      <form
        className="col gap-lg"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save();
        }}
      >
        <Field label="주간 목표 미달성 1회당 벌금" htmlFor="fine-amount" hint="100원 단위 · 0원이면 벌금 규칙을 꺼요">
          <div className="unit-input wide">
            <input id="fine-amount" className="input num" inputMode="numeric" pattern="[0-9]*" maxLength={7} value={val} placeholder="0" onChange={(e) => setVal(e.target.value.replace(/\D/g, '').slice(0, 7))} />
            <span>원</span>
          </div>
        </Field>
        <div className="chips-wrap" role="group" aria-label="자주 쓰는 금액">
          {[0, 1000, 3000, 5000, 10000].map((n) => (
            <button key={n} type="button" className={'chip pick' + (amount === n ? ' on' : '')} onClick={() => setVal(n ? String(n) : '')}>
              {n === 0 ? '끄기' : won(n)}
            </button>
          ))}
        </div>
        {!valid ? (
          <p className="error-text" role="alert">
            100원 단위로, 100만 원 이하로 적어 주세요.
          </p>
        ) : null}
        <p className="note">
          {study.fineFrom && study.fineAmount ? `${fmtShort(study.fineFrom)} 주부터 적용 중이에요. ` : '처음 켜면 이번 주부터 적용하고, 지난 주에는 소급하지 않아요. '}
          한 주가 끝났을 때 목표를 못 채운 멤버가 장부에 기록돼요. 앱은 기록만 하고 실제 송금은 하지 않아요.
        </p>
      </form>
    </SheetFrame>
  );
}
