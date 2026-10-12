import type { UUID } from 'crypto';

import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Admin form labels aren't bound to their controls (no htmlFor), so a field
 * is the element right after its <label>.
 */
function field(scope: Locator, label: string): Locator {
  return scope.locator(
    `xpath=.//label[normalize-space(.)="${label}"]/following-sibling::*[1]`,
  );
}

export interface NewTournament {
  name: string;
  venue: string;
  sport: string;
  discipline: string;
  /** Option label as the select shows it, e.g. "Single Elimination". */
  format: string;
  winScore: number;
  tables: string[];
  maxParticipants?: number;
  /** Double elimination only: «Раунд объединения» option label. */
  mergeRound?: string;
  /** Elimination formats: «Случайные пары после каждого раунда». */
  randomAdvancement?: boolean;
}

/** «Турниры» list + the «Новый турнир» modal. */
export class AdminTournamentsPage {
  constructor(private readonly page: Page) {}

  async createTournament(t: NewTournament): Promise<UUID> {
    const { page } = this;
    await page.goto('/tournaments');
    await page.getByRole('button', { name: '+ Новый турнир' }).click();

    // Found by a field, not by the submit button: its label flips to
    // «Создание...» while the request runs, which would lose the form.
    const form = page
      .locator('form')
      .filter({ has: page.locator('label', { hasText: 'Название *' }) });
    await field(form, 'Название *').fill(t.name);
    await field(form, 'Площадка *').selectOption({ label: t.venue });
    await field(form, 'Вид бильярда').selectOption({ label: t.sport });
    await field(form, 'Дисциплина').selectOption({ label: t.discipline });
    await field(form, 'Формат').selectOption({ label: t.format });
    // After the format: the checkbox only exists for elimination brackets.
    if (t.randomAdvancement) {
      await form.getByLabel('Случайные пары после каждого раунда').check();
    }
    if (t.maxParticipants !== undefined) {
      await field(form, 'Макс. участников').selectOption(
        String(t.maxParticipants),
      );
    }
    // After the size: the merge-round options depend on it.
    if (t.mergeRound !== undefined) {
      await field(form, 'Раунд объединения').selectOption({
        label: t.mergeRound,
      });
    }
    // After discipline: changing it resets the win score to its default.
    await field(form, 'Win score').selectOption(String(t.winScore));
    for (const table of t.tables) {
      await form.getByRole('button', { name: table, exact: true }).click();
    }
    await form.getByRole('button', { name: 'Создать' }).click();
    try {
      // The modal closes only once the server has accepted the tournament.
      await expect(form).toBeHidden();
    } catch (e) {
      const refusal = form.locator('.bg-red-50');
      if (await refusal.isVisible()) {
        throw new Error(`«Создать» отклонено: ${await refusal.innerText()}`);
      }
      throw e;
    }

    // The list renders both a mobile card list and a desktop table; the cell
    // is the visible one at desktop width.
    await page.getByRole('cell', { name: t.name, exact: true }).click();
    await page.waitForURL(/\/tournaments\/[0-9a-f-]{36}/);
    const id = /\/tournaments\/([0-9a-f-]{36})/.exec(page.url())?.[1];
    if (!id) throw new Error(`no tournament id in ${page.url()}`);
    return id as UUID;
  }
}

/** One tournament: header actions and tabs. */
export class AdminTournamentPage {
  constructor(
    private readonly page: Page,
    readonly id: UUID,
  ) {}

  async open(tab?: 'participants' | 'standings' | 'matches'): Promise<void> {
    await this.page.goto(`/tournaments/${this.id}${tab ? `?tab=${tab}` : ''}`);
  }

  /**
   * Click the header's next-step button («Открыть регистрацию» → «Закрыть
   * регистрацию» → «Запустить турнир») and wait for the status to move on:
   * the button is relabelled «Обработка...» while the request runs and then
   * either replaced by the next step or restored next to a red refusal box.
   */
  async advance(
    label: 'Открыть регистрацию' | 'Закрыть регистрацию' | 'Запустить турнир',
  ): Promise<void> {
    const { page } = this;
    // Only the start asks `confirm()`. A listener left unfired by another step
    // would later race this one for the same dialog.
    if (label === 'Запустить турнир')
      page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: label }).click();

    // The header's own error box; the participants tab paints seed warnings
    // with bg-red-50 too, but in text-red-600.
    const refusal = page.locator('.bg-red-50.text-red-700');
    const stillHere = page.getByRole('button', {
      name: new RegExp(`^(${label}|Обработка\\.\\.\\.)$`),
    });
    let refusalText: string | undefined;
    await expect
      .poll(
        async () => {
          if (await refusal.isVisible()) {
            refusalText = await refusal.innerText();
            return 'refused';
          }
          return (await stillHere.count()) === 0 ? 'done' : 'pending';
        },
        { message: `«${label}» → next step` },
      )
      .not.toBe('pending');
    if (refusalText !== undefined) {
      throw new Error(`«${label}» отклонено: ${refusalText}`);
    }
  }

  /** Rows show the first name and "@username"; the username is unique. */
  async confirmParticipant(username: string): Promise<void> {
    const row = this.page.locator('tr', { hasText: `@${username}` });
    const confirm = row.getByRole('button', { name: 'Подтвердить' });
    await confirm.click();
    await expect(confirm).toBeHidden();
  }

  /** Standings row («Таблица» tab) by the player's first name. */
  standingsRow(firstName: string): Locator {
    return this.page.locator('tr').filter({
      has: this.page.getByRole('cell', { name: firstName, exact: true }),
    });
  }
}
