// Беспарольный вход, как на сайте игрока: email → 6-значный код на почту → проверка.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { auth, type MeResponse } from '../lib/api.ts';
import { useMe } from '../lib/useAuth.ts';

// Ошибки редиректа из GET /api/auth/token (ссылки /dashboard и «Админка»).
const LINK_ERRORS: Record<string, string> = {
  forbidden: 'У этого аккаунта нет прав администратора.',
  invalid: 'Ссылка для входа недействительна или истекла.',
  ratelimit:
    'Слишком много попыток входа. Подождите минуту и попробуйте снова.',
};

const inputClass =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const submitClass =
  'w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50';

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">
      {message}
    </div>
  );
}

export default function LoginPage() {
  const qc = useQueryClient();
  const { data } = useMe();
  const linkError =
    LINK_ERRORS[new URLSearchParams(window.location.search).get('error') ?? ''];

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');

  const requestMut = useMutation({
    mutationFn: () => auth.requestCode(email.trim()),
    onSuccess: () => setStep('code'),
  });

  const verifyMut = useMutation({
    mutationFn: () => auth.verifyCode(email.trim(), code.trim()),
    onSuccess: ({ user }) => {
      // App.tsx отрисует админку, как только в ['auth','me'] появится user.
      qc.setQueryData<MeResponse>(['auth', 'me'], (prev) => ({
        playerUrl: prev?.playerUrl ?? '',
        user,
      }));
      window.history.replaceState(null, '', '/');
    },
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 w-full max-w-sm">
        <h2 className="text-xl font-semibold text-gray-900 mb-1">
          Панель управления
        </h2>

        {step === 'email' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              requestMut.mutate();
            }}
            className="space-y-4"
          >
            <p className="text-sm text-gray-500">
              Введите почту — пришлём 6-значный код для входа.
            </p>
            {linkError && <ErrorBox message={linkError} />}
            <input
              type="email"
              required
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
            {requestMut.error && (
              <ErrorBox message={requestMut.error.message} />
            )}
            <button
              type="submit"
              disabled={requestMut.isPending || !email.trim()}
              className={submitClass}
            >
              {requestMut.isPending ? 'Отправка…' : 'Получить код'}
            </button>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              verifyMut.mutate();
            }}
            className="space-y-4"
          >
            <p className="text-sm text-gray-500">
              Мы отправили код на{' '}
              <b className="text-gray-700">{email.trim()}</b>. Он действует 10
              минут.
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className={`${inputClass} text-center text-xl tracking-[0.3em]`}
            />
            {verifyMut.error && <ErrorBox message={verifyMut.error.message} />}
            <button
              type="submit"
              disabled={verifyMut.isPending || code.length !== 6}
              className={submitClass}
            >
              {verifyMut.isPending ? 'Проверка…' : 'Войти'}
            </button>
            <button
              type="button"
              onClick={() => {
                setCode('');
                verifyMut.reset();
                setStep('email');
              }}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              ← Изменить почту
            </button>
          </form>
        )}

        <p className="mt-6 pt-4 border-t border-gray-100 text-xs text-gray-400 text-center">
          Почта не привязана? <br />
          Войдите командой{' '}
          <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-700">
            /dashboard
          </code>{' '}
          в боте
        </p>
      </div>
    </div>
  );
}
