import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { auth } from "../lib/api.ts";

type Step = "username" | "code";

export default function LoginPage() {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("username");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const requestCode = useMutation({
    mutationFn: () => auth.requestCode(username),
    onSuccess: () => {
      setError("");
      setStep("code");
    },
    onError: (e: Error) => setError(e.message),
  });

  const verifyCode = useMutation({
    mutationFn: () => auth.verifyCode(username, code),
    onSuccess: (data) => {
      qc.setQueryData(["auth", "me"], { user: data.user });
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 w-full max-w-sm">
        <h2 className="text-xl font-semibold text-gray-900 mb-1">
          Панель управления
        </h2>
        <p className="text-sm text-gray-500 mb-6">
          {step === "username"
            ? "Введите ваш Telegram username"
            : `Код отправлен @${username} в Telegram`}
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">
            {error}
          </div>
        )}

        {step === "username" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              requestCode.mutate();
            }}
          >
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Telegram username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="@username"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={requestCode.isPending || !username.trim()}
              className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {requestCode.isPending ? "Отправка..." : "Получить код"}
            </button>
            <p className="mt-3 text-xs text-gray-400 text-center">
              Вы должны предварительно написать /start боту в Telegram
            </p>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              verifyCode.mutate();
            }}
          >
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                6-значный код
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                maxLength={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center text-xl tracking-widest"
                required
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={verifyCode.isPending || code.length !== 6}
              className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {verifyCode.isPending ? "Проверка..." : "Войти"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("username");
                setCode("");
                setError("");
              }}
              className="w-full mt-2 text-sm text-gray-500 hover:text-gray-700 py-1"
            >
              Назад
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
