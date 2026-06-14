export default function LoginPage() {
  const params = new URLSearchParams(window.location.search);
  const errorCode = params.get('error');

  const errorText =
    errorCode === 'forbidden'
      ? 'У этого аккаунта нет прав администратора.'
      : errorCode === 'invalid'
        ? 'Ссылка для входа недействительна или истекла. Запросите новую командой /dashboard.'
        : '';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 w-full max-w-sm">
        <h2 className="text-xl font-semibold text-gray-900 mb-1">
          Панель управления
        </h2>
        <p className="text-sm text-gray-500 mb-6">Вход через Telegram-бота</p>

        {errorText && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">
            {errorText}
          </div>
        )}

        <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
          <li>Откройте бота в Telegram.</li>
          <li>
            Отправьте команду{' '}
            <code className="px-1 py-0.5 bg-gray-100 rounded text-gray-900">
              /dashboard
            </code>
            .
          </li>
          <li>Нажмите «Открыть панель управления» — откроется эта админка.</li>
        </ol>

        <p className="mt-6 text-xs text-gray-400 text-center">
          Ссылка действительна 5 минут и доступна только администраторам.
        </p>
      </div>
    </div>
  );
}
