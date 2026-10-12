import type { UUID } from 'crypto';

import { expect, type Locator, type Page } from '@playwright/test';

/** Player site: tournament page (registration). */
export class PlayerTournamentPage {
  constructor(
    private readonly page: Page,
    readonly id: UUID,
  ) {}

  async open(): Promise<void> {
    await this.page.goto(`/tournaments/${this.id}`);
  }

  async register(): Promise<void> {
    await this.open();
    await this.page.getByRole('button', { name: 'Зарегистрироваться' }).click();
    await expect(
      this.page.getByText('Заявка ожидает подтверждения.'),
    ).toBeVisible();
  }
}

/**
 * Player site: «Матчи» list and the match modal opened from it.
 *
 * While a request is in flight the modal relabels its button («Отправка…»,
 * «Подтверждение…»), so "the button is gone" would pass before the server
 * answers. Each action therefore waits for the state the modal shows after
 * a successful response.
 */
export class PlayerMatchesPage {
  constructor(private readonly page: Page) {}

  /** Fresh load of /matches + open the modal, so it shows current state. */
  async openMatch(matchId: UUID): Promise<void> {
    await this.page.goto('/matches');
    await this.page.locator(`[data-match-id="${matchId}"]`).click();
  }

  button(name: string): Locator {
    return this.page.getByRole('button', { name, exact: true });
  }

  async markReady(matchId: UUID): Promise<void> {
    await this.openMatch(matchId);
    await this.button('Я у стола').click();
    // First to check in: the modal waits for the opponent. Second: the match
    // starts and the modal switches straight to the score form.
    await expect(
      this.page
        .getByText('Вы у стола — ждём соперника')
        .or(this.button('Отправить результат')),
    ).toBeVisible();
  }

  /** Scores are keyed by the players' display names (the inputs' aria-label). */
  async report(
    matchId: UUID,
    scores: { name: string; score: number }[],
  ): Promise<void> {
    await this.openMatch(matchId);
    for (const { name, score } of scores) {
      await this.page.getByLabel(name, { exact: true }).fill(String(score));
    }
    await this.button('Отправить результат').click();
    await expect(
      this.page.getByText('Ожидает подтверждения соперником'),
    ).toBeVisible();
  }

  /**
   * Snooker: the result is entered frame by frame. «＋ Фрейм» saves the row
   * as a draft and opens the next one; the last row may stay unsaved. Breaks
   * are optional and left blank.
   */
  async reportFrames(
    matchId: UUID,
    frames: { p1: number; p2: number }[],
  ): Promise<void> {
    await this.openMatch(matchId);
    for (const [i, frame] of frames.entries()) {
      const n = String(i + 1);
      await this.page
        .getByLabel(`Фрейм ${n}, счёт 1`, { exact: true })
        .fill(String(frame.p1));
      await this.page
        .getByLabel(`Фрейм ${n}, счёт 2`, { exact: true })
        .fill(String(frame.p2));
      if (i < frames.length - 1) {
        await this.button('＋ Фрейм').click();
        // The next row appears once the draft frame is saved.
        await expect(
          this.page.getByLabel(`Фрейм ${String(i + 2)}, счёт 1`, {
            exact: true,
          }),
        ).toBeVisible();
      }
    }
    await this.button('Отправить результат').click();
    await expect(
      this.page.getByText('Ожидает подтверждения соперником'),
    ).toBeVisible();
  }

  async confirm(matchId: UUID): Promise<void> {
    await this.openMatch(matchId);
    await this.button('Подтвердить').click();
    await expect(this.page.getByText('Результат подтверждён')).toBeVisible();
  }
}
