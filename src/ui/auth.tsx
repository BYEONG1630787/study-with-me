// GitHub Pages 판의 첫 화면: 로그인과 회원가입(이메일·비밀번호).
// 가입이 끝나면 앱으로 넘어가 닉네임을 만드는 화면(2단계)이 이어진다.

import React, { useState } from 'react';
import { FIREBASE_CONFIG } from '../env';
import { resetPassword, signIn, signUp } from '../firebase';
import { Wordmark } from './app';
import { Btn, Field } from './kit';

type Mode = 'login' | 'signup' | 'reset';

export function AuthScreen({ onDone }: { onDone: () => void }) {
  const joining = /^#?join-/i.test(location.hash || '');
  const [mode, setMode] = useState<Mode>(joining ? 'signup' : 'login');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const cfg = FIREBASE_CONFIG!;

  const switchTo = (m: Mode) => {
    setMode(m);
    setErr('');
    setInfo('');
  };

  const submit = async () => {
    setErr('');
    setInfo('');
    const em = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return setErr('이메일 주소를 다시 확인해 주세요.');
    if (mode !== 'reset') {
      if (pw.length < 6) return setErr('비밀번호는 6자 이상이에요.');
      if (mode === 'signup' && pw !== pw2) return setErr('비밀번호 확인이 서로 달라요.');
    }
    setBusy(true);
    try {
      if (mode === 'login') await signIn(cfg, em, pw);
      else if (mode === 'signup') await signUp(cfg, em, pw);
      else {
        await resetPassword(cfg, em);
        setInfo('비밀번호를 다시 만드는 메일을 보냈어요. 메일함(스팸함도)을 확인해 주세요.');
        setBusy(false);
        return;
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="gate onboarding" id="auth">
      <Wordmark big />
      <p className="display gate-tag">친구들과 함께 채우는 공부 인증 플래너</p>
      <form
        className="card col gap-lg gate-card"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!(e.nativeEvent as unknown as { isComposing?: boolean }).isComposing) void submit();
        }}
      >
        {mode !== 'reset' ? (
          <div className="seg" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'login'} className={'seg-item' + (mode === 'login' ? ' on' : '')} onClick={() => switchTo('login')} id="auth-tab-login">
              로그인
            </button>
            <button type="button" role="tab" aria-selected={mode === 'signup'} className={'seg-item' + (mode === 'signup' ? ' on' : '')} onClick={() => switchTo('signup')} id="auth-tab-signup">
              회원가입
            </button>
          </div>
        ) : (
          <p className="label">비밀번호 다시 만들기</p>
        )}
        {mode === 'signup' ? <p className="hint">1단계 계정 만들기 → 2단계 닉네임 정하기. 가입하면 친구에게 받은 초대도 이어서 받을 수 있어요.</p> : null}
        <Field label="이메일" htmlFor="auth-email">
          <input id="auth-email" className="input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
        </Field>
        {mode !== 'reset' ? (
          <Field label="비밀번호" htmlFor="auth-pw" hint={mode === 'signup' ? '6자 이상' : undefined}>
            <input id="auth-pw" className="input" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
        ) : null}
        {mode === 'signup' ? (
          <Field label="비밀번호 확인" htmlFor="auth-pw2">
            <input id="auth-pw2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </Field>
        ) : null}
        {err ? (
          <p className="note" role="alert" id="auth-err">
            {err}
          </p>
        ) : null}
        {info ? (
          <p className="note" role="status" id="auth-info">
            {info}
          </p>
        ) : null}
        <Btn type="submit" block size="lg" busy={busy} id="auth-submit">
          {mode === 'login' ? '로그인' : mode === 'signup' ? '가입하고 다음으로' : '메일 보내기'}
        </Btn>
        {mode === 'login' ? (
          <button type="button" className="text-btn" onClick={() => switchTo('reset')} id="auth-forgot">
            비밀번호를 잊었어요
          </button>
        ) : mode === 'reset' ? (
          <button type="button" className="text-btn" onClick={() => switchTo('login')} id="auth-back">
            로그인으로 돌아가기
          </button>
        ) : null}
      </form>
    </div>
  );
}
