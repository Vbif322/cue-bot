import { describe, it, expect } from 'vitest';

import {
  ANNOUNCEMENT_DESCRIPTION_LIMIT,
  buildAnnouncementKeyboard,
  buildRegistrationOpenAnnouncement,
} from '@/bot/ui/groupAnnouncementUI.js';
import type { TournamentAnnouncement } from '@/bot/ui/groupAnnouncementUI.js';

const TOURNAMENT_ID = '11111111-2222-4333-8444-555555555555';

function make(
  overrides: Partial<TournamentAnnouncement> = {},
): TournamentAnnouncement {
  return {
    id: TOURNAMENT_ID,
    name: 'Осенний кубок',
    sport: 'pool',
    discipline: 'pool_8',
    format: 'single_elimination',
    randomAdvancement: false,
    venueName: 'Клуб Пирамида',
    startDate: new Date('2026-10-12T18:00:00Z'),
    maxParticipants: 16,
    participantsCount: 3,
    winScore: 5,
    description: null,
    ...overrides,
  };
}

describe('buildRegistrationOpenAnnouncement', () => {
  it('содержит заголовок, название, площадку и счётчик участников', () => {
    const text = buildRegistrationOpenAnnouncement(make());

    expect(text).toContain('Открыта регистрация!');
    expect(text).toContain('*Осенний кубок*');
    expect(text).toContain('Клуб Пирамида');
    expect(text).toContain('Участников: 3/16');
    expect(text).toContain('Игра до: 5 побед');
  });

  it('экранирует Markdown в названии, площадке и описании', () => {
    const text = buildRegistrationOpenAnnouncement(
      make({
        name: 'Кубок *звёзд*_2026',
        venueName: 'Клуб _Луза_',
        description: 'Взнос 500 [руб]',
      }),
    );

    expect(text).toContain('Кубок \\*звёзд\\*\\_2026');
    expect(text).toContain('Клуб \\_Луза\\_');
    expect(text).toContain('Взнос 500 \\[руб]');
    // Звёздочки из самого шаблона (жирное название) остаются неэкранированными.
    expect(text).toContain('*Кубок \\*звёзд\\*\\_2026*');
  });

  it('подставляет «Не указана» для пустой площадки и даты', () => {
    const text = buildRegistrationOpenAnnouncement(
      make({ venueName: null, startDate: null }),
    );

    expect(text).toContain('Площадка: Не указана');
    expect(text).toContain('Дата: Не указана');
  });

  it('опускает блок описания, когда его нет или оно пустое', () => {
    expect(buildRegistrationOpenAnnouncement(make())).not.toContain('Взнос');
    const blank = buildRegistrationOpenAnnouncement(
      make({ description: '   ' }),
    );
    expect(blank).toContain('Участников: 3/16');
    expect(blank.trimEnd().endsWith('по кнопке ниже.')).toBe(true);
  });

  it('режет длинное описание до лимита', () => {
    const text = buildRegistrationOpenAnnouncement(
      make({ description: 'я'.repeat(400) }),
    );

    expect(text).toContain('я'.repeat(ANNOUNCEMENT_DESCRIPTION_LIMIT));
    expect(text).not.toContain('я'.repeat(ANNOUNCEMENT_DESCRIPTION_LIMIT + 1));
  });

  it('не срезает описание посреди экранирующего слэша', () => {
    // Символ на границе среза — тот, что подлежит экранированию.
    const text = buildRegistrationOpenAnnouncement(
      make({
        description: `${'я'.repeat(ANNOUNCEMENT_DESCRIPTION_LIMIT - 1)}*хвост`,
      }),
    );

    expect(text).not.toMatch(/\\\n/);
    expect(text).toContain(
      `${'я'.repeat(ANNOUNCEMENT_DESCRIPTION_LIMIT - 1)}\\*`,
    );
  });

  it('показывает пометку про рандом в формате', () => {
    const text = buildRegistrationOpenAnnouncement(
      make({ randomAdvancement: true }),
    );

    expect(text).toContain('(рандом)');
  });
});

describe('buildAnnouncementKeyboard', () => {
  it('строит ровно одну URL-кнопку в личку бота', () => {
    const keyboard = buildAnnouncementKeyboard(TOURNAMENT_ID, 'cue_bot');
    const rows = keyboard.inline_keyboard;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(1);

    const button = rows[0]?.[0];
    expect(button).toMatchObject({
      text: 'Участвовать',
      url: `https://t.me/cue_bot?start=t_${TOURNAMENT_ID}`,
    });
    // Никаких callback'ов в группу: они там намеренно отбрасываются.
    expect(button).not.toHaveProperty('callback_data');
  });

  it('payload укладывается в лимит Telegram (64 символа)', () => {
    const keyboard = buildAnnouncementKeyboard(TOURNAMENT_ID, 'cue_bot');
    const url = keyboard.inline_keyboard[0]?.[0];
    const payload = new URL((url as { url: string }).url).searchParams.get(
      'start',
    );

    expect(payload).toBe(`t_${TOURNAMENT_ID}`);
    expect(payload?.length).toBeLessThanOrEqual(64);
  });
});
