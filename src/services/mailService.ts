import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Отправка почты через nodemailer. В проде — реальный SMTP (env `SMTP_*`), в dev
 * (когда `SMTP_HOST` не задан) — `jsonTransport`: письмо не уходит наружу, а его
 * тело печатается в консоль, поэтому 6-значный код входа виден локально. Сервис не
 * должен падать без SMTP-настроек — вход по коду тестируется без почтового сервера.
 */

const MAIL_FROM = process.env.MAIL_FROM ?? 'Cue Bot <no-reply@cue-bot.local>';

let transporter: Transporter | undefined;
let devMode = false;

/**
 * Fail-fast для старта: в проде без `SMTP_HOST` почтовый транспорт молча свалился
 * бы в `jsonTransport` (письма не уходят, код только в логах), а `request-code`
 * всё равно отвечает 200 — сбой был бы невидим. Поэтому в production при пустом
 * `SMTP_HOST` бросаем на старте, как `db.ts` при отсутствии `DATABASE_URL`.
 */
export function assertMailConfigured(): void {
  if (process.env.NODE_ENV === 'production' && !process.env.SMTP_HOST) {
    throw new Error(
      'SMTP_HOST не задан в production — беспарольный вход по почте не будет работать. ' +
        'Задайте SMTP_* в окружении или отключите почтовый вход.',
    );
  }
}

function getTransporter(): Transporter {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  if (host) {
    transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
    });
  } else {
    // Dev-режим: письма не уходят, тело логируется (код виден в консоли).
    devMode = true;
    transporter = nodemailer.createTransport({ jsonTransport: true });
  }

  return transporter;
}

/**
 * Отправляет письмо с одноразовым кодом входа. Текст на русском. В dev-режиме
 * дополнительно печатает код в консоль, чтобы его можно было ввести локально.
 */
export async function sendLoginCodeEmail(
  to: string,
  code: string,
): Promise<void> {
  const subject = 'Код для входа';
  const text =
    `Ваш код для входа: ${code}\n\n` +
    'Код действует 10 минут. Если вы не запрашивали вход, просто проигнорируйте это письмо.';

  const info: unknown = await getTransporter().sendMail({
    from: MAIL_FROM,
    to,
    subject,
    text,
  });

  if (devMode) {
    console.log(
      `[mailService] dev-режим, письмо не отправлено. Код для ${to}: ${code}`,
    );
    // Для jsonTransport `info.message` — тело письма в виде JSON-строки.
    const message = (info as { message?: unknown }).message;
    if (typeof message === 'string') console.log(message);
  }
}
