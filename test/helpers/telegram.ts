import { createHash, createHmac } from 'crypto';

/**
 * Подписывает набор полей Telegram Login Widget тем же алгоритмом, что проверяет
 * `verifyTelegramLogin`: secret = SHA256(token), data_check_string — все поля
 * (кроме hash), отсортированные по ключу, "key=value" через "\n". Возвращает
 * поля с добавленным валидным `hash`. Используется юнит- и интеграционными тестами.
 */
export function signTelegramPayload(
  fields: Record<string, unknown>,
  token: string,
): Record<string, unknown> & { hash: string } {
  const dataCheckString = Object.keys(fields)
    .filter((key) => key !== 'hash')
    .sort()
    .map((key) => `${key}=${String(fields[key])}`)
    .join('\n');
  const secret = createHash('sha256').update(token).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return { ...fields, hash };
}
