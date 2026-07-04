// Беспарольный вход: email → 6-значный код на почту → верификация.
import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { appAuth } from '../lib/api.ts';
import { Btn, Field } from '../components/controls.tsx';
import { ErrorBox } from '../components/ui.tsx';

export default function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const from = (loc.state as { from?: string } | null)?.from ?? '/';

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');

  const requestMut = useMutation({
    mutationFn: () => appAuth.requestCode(email.trim()),
    onSuccess: () => setStep('code'),
  });

  const verifyMut = useMutation({
    mutationFn: () => appAuth.verifyCode(email.trim(), code.trim()),
    onSuccess: (data) => {
      qc.setQueryData(['auth', 'me'], { user: data.user });
      nav(from, { replace: true });
    },
  });

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        boxSizing: 'border-box',
        background: '#0d0e12',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 380,
          boxSizing: 'border-box',
          background: '#17181e',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 20,
          padding: 28,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              background: 'var(--color-primary)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 15,
              fontWeight: 800,
              color: '#fff',
            }}
          >
            C
          </span>
          <span style={{ fontSize: 18, fontWeight: 700 }}>cue·bot</span>
        </div>

        {step === 'email' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              requestMut.mutate();
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 19, fontWeight: 700 }}>Вход в аккаунт</div>
              <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>
                Введите почту — пришлём 6-значный код для входа.
              </div>
            </div>
            <Field
              type="email"
              required
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {requestMut.error && <ErrorBox message={requestMut.error.message} />}
            <Btn block type="submit" disabled={requestMut.isPending || !email.trim()}>
              {requestMut.isPending ? 'Отправка…' : 'Получить код'}
            </Btn>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              verifyMut.mutate();
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 19, fontWeight: 700 }}>Введите код</div>
              <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>
                Мы отправили код на <b style={{ color: '#d1d5db' }}>{email.trim()}</b>. Он
                действует 10 минут.
              </div>
            </div>
            <Field
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              style={{ textAlign: 'center', letterSpacing: '0.3em', fontSize: 20 }}
            />
            {verifyMut.error && <ErrorBox message={verifyMut.error.message} />}
            <Btn block type="submit" disabled={verifyMut.isPending || code.length !== 6}>
              {verifyMut.isPending ? 'Проверка…' : 'Войти'}
            </Btn>
            <button
              type="button"
              onClick={() => {
                setCode('');
                setStep('email');
              }}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#9aa0aa',
                fontSize: 13,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              ← Изменить почту
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
