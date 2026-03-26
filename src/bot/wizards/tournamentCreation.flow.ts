import type { Tournament } from '../@types/tournament.js';
import type { BotContext } from '../types.js';
import type { ICreationState } from './tournamentCreation.js';
import type { ITournamentCreationRenderer } from './tournamentCreation.renderer.js';
import type { ITournamentCreationStateStore } from './tournamentCreation.stateStore.js';

// #region Types / Interfaces

// #endregion

// #region Class

export class TournamentCreationFlow {
  constructor(
    private readonly stateStore: ITournamentCreationStateStore,
    private readonly renderer: ITournamentCreationRenderer,
  ) {}

  start(userId: number): void {
    this.stateStore.start(userId);
  }

  cancel(userId: number): boolean {
    return this.stateStore.clear(userId);
  }

  getState(userId: number): ICreationState | undefined {
    return this.stateStore.get(userId);
  }

  async handleNameInput(
    ctx: BotContext,
    name: Tournament['name'],
  ): Promise<boolean> {
    const userId = this.getUserId(ctx);

    if (!userId) return false;

    if (!this.stateStore.hasStep(userId, 'name')) {
      return false;
    }

    const clearedName = name.trim();

    if (clearedName.length < 3) {
      await this.renderer.showInvalidName(ctx);

      return true;
    }

    this.stateStore.update(userId, {
      step: 'date',
      data: {
        tournament: {
          name: clearedName,
        },
      },
    });

    await this.renderer.showDateStep(ctx, name);

    return true;
  }

  async handleDateInput(ctx: BotContext, text: string): Promise<boolean> {
    const userId = this.getUserId(ctx);
    if (!userId) return false;

    if (!this.stateStore.hasStep(userId, 'date')) {
      return false;
    }

    const parsedDate = parseDate(text.trim());

    if (!parsedDate) {
      await ctx.reply('Не удалось распознать дату, попробуйте еще раз');
      return true;
    }

    const venues = await getVenues();

    if (venues.length === 0) {
      this.stateStore.clear(userId);
      await ctx.reply(
        'Нельзя создать турнир: в системе нет ни одной площадки.',
      );
      return true;
    }

    this.stateStore.update(userId, {
      step: 'venue',
      data: { startDate: parsedDate },
    });

    await this.renderer.showVenueStep(ctx, parsedDate, venues);

    return true;
  }

  async handleVenueSelection(ctx: BotContext, venueId: string): Promise<void> {
    const session = await this.requireStep(ctx, 'venue');
    if (!session) return;

    const venue = await getVenue(venueId);

    if (!venue) {
      await ctx.answerCallbackQuery({
        text: 'Площадка не найдена',
        show_alert: true,
      });
      return;
    }

    this.stateStore.update(session.userId, {
      step: 'discipline',
      data: {
        venueId: venue.id,
        venueName: venue.name,
      },
    });

    await ctx.answerCallbackQuery();
    await this.renderer.showDisciplineStep(ctx, venue.name);
  }

  async handleDisciplineSelection(
    ctx: BotContext,
    selectedDiscipline: string,
  ): Promise<void> {
    const session = await this.requireStep(ctx, 'discipline');
    if (!session) return;

    if (!this.isDiscipline(selectedDiscipline)) {
      await ctx.answerCallbackQuery({
        text: 'Некорректная дисциплина',
        show_alert: true,
      });
      return;
    }

    this.stateStore.update(session.userId, {
      step: 'format',
      data: {
        discipline: selectedDiscipline,
      },
    });

    await ctx.answerCallbackQuery();
    await this.renderer.showFormatStep(ctx, selectedDiscipline);
  }

  async handleFormatSelection(
    ctx: BotContext,
    selectedFormat: string,
  ): Promise<void> {
    const session = await this.requireStep(ctx, 'format');
    if (!session) return;

    if (!this.isTournamentFormat(selectedFormat)) {
      await ctx.answerCallbackQuery({
        text: 'Некорректный формат турнира',
        show_alert: true,
      });
      return;
    }

    this.stateStore.update(session.userId, {
      step: 'maxParticipants',
      data: {
        format: selectedFormat,
      },
    });

    await ctx.answerCallbackQuery();
    await this.renderer.showMaxParticipantsStep(ctx, selectedFormat);
  }

  async handleMaxParticipantsSelection(
    ctx: BotContext,
    participants: number,
  ): Promise<void> {
    const session = await this.requireStep(ctx, 'maxParticipants');
    if (!session) return;

    if (!this.isAllowedParticipantsCount(participants)) {
      await ctx.answerCallbackQuery({
        text: 'Некорректное количество участников',
        show_alert: true,
      });
      return;
    }

    this.stateStore.update(session.userId, {
      step: 'winScore',
      data: {
        maxParticipants: participants,
      },
    });

    await ctx.answerCallbackQuery();
    await this.renderer.showWinScoreStep(ctx, participants);
  }

  async handleWinScoreSelection(
    ctx: BotContext,
    winScore: number,
  ): Promise<void> {
    const session = await this.requireStep(ctx, 'winScore');
    if (!session) return;

    if (!this.isAllowedWinScore(winScore)) {
      await ctx.answerCallbackQuery({
        text: 'Некорректное количество побед',
        show_alert: true,
      });
      return;
    }

    if (!session.state.data.venueId) {
      this.stateStore.clear(session.userId);
      await ctx.answerCallbackQuery({
        text: 'Площадка не выбрана',
        show_alert: true,
      });
      return;
    }

    const nextState = this.stateStore.update(session.userId, {
      step: 'tables',
      data: {
        winScore,
        selectedTableIds: [],
      },
    });

    await ctx.answerCallbackQuery();
    await this.renderTablesStep(ctx, nextState);
  }

  async handleTableSelectionToggle(
    ctx: BotContext,
    tableId: string,
  ): Promise<void> {
    const session = await this.requireStep(ctx, 'tables');
    if (!session) return;

    const venueId = session.state.data.venueId;
    if (!venueId) {
      this.stateStore.clear(session.userId);
      await ctx.answerCallbackQuery({
        text: 'Площадка не выбрана',
        show_alert: true,
      });
      return;
    }

    const tables = await getTablesByVenue(venueId);

    if (!tables.some((table) => table.id === tableId)) {
      await ctx.answerCallbackQuery({
        text: 'Можно выбрать только столы выбранной площадки',
        show_alert: true,
      });
      return;
    }

    const selected = new Set(session.state.data.selectedTableIds ?? []);

    if (selected.has(tableId)) {
      selected.delete(tableId);
    } else {
      selected.add(tableId);
    }

    const nextState = this.stateStore.update(session.userId, {
      data: {
        selectedTableIds: Array.from(selected),
      },
    });

    await ctx.answerCallbackQuery();
    await this.renderTablesStep(ctx, nextState, tables);
  }

  async handleTableSelectionDone(ctx: BotContext): Promise<void> {
    const session = await this.requireStep(ctx, 'tables');
    if (!session) return;

    await ctx.answerCallbackQuery();
    await this.finalizeTournamentCreation(
      ctx,
      session.state,
      session.state.data.selectedTableIds ?? [],
    );
  }

  async handleTableSelectionSkip(ctx: BotContext): Promise<void> {
    const session = await this.requireStep(ctx, 'tables');
    if (!session) return;

    await ctx.answerCallbackQuery();
    await this.finalizeTournamentCreation(ctx, session.state, []);
  }

  private getUserId(ctx: BotContext): number | null {
    return ctx.from?.id ?? null;
  }

  private async renderTablesStep(
    ctx: BotContext,
    state: CreationState,
    tables?: Awaited<ReturnType<typeof getTablesByVenue>>,
  ): Promise<void> {
    const venueId = state.data.venueId;

    const availableTables =
      tables ?? (venueId ? await getTablesByVenue(venueId) : []);

    await this.renderer.showTablesStep(ctx, state, availableTables);
  }

  private async finalizeTournamentCreation(
    ctx: BotContext,
    state: CreationState,
    tableIds: string[],
  ): Promise<void> {
    const userId = this.getUserId(ctx);
    if (!userId) return;

    if (!this.hasRequiredCreationData(state.data)) {
      this.stateStore.clear(userId);
      await this.renderer.showCorruptedSession(ctx);
      return;
    }

    try {
      const tournament = await createTournamentDraft({
        name: state.data.name,
        discipline: state.data.discipline,
        format: state.data.format,
        maxParticipants: state.data.maxParticipants,
        winScore: state.data.winScore,
        startDate: state.data.startDate ?? null,
        venueId: state.data.venueId,
        tableIds,
        createdBy: ctx.dbUser.id,
      });

      this.stateStore.clear(userId);

      await this.renderer.showCreationSuccess(
        ctx,
        tournament,
        state.data.venueName,
        tableIds.length,
      );
    } catch (error) {
      console.error('Error creating tournament:', error);

      await this.renderer.showCreationError(
        ctx,
        error instanceof Error ? error.message : 'Неизвестная ошибка',
      );
    }
  }

  private async requireStep(
    ctx: BotContext,
    step: CreationStep,
  ): Promise<{ userId: number; state: CreationState } | null> {
    const userId = this.getUserId(ctx);
    if (!userId) return null;

    const state = this.stateStore.get(userId);

    if (!state || state.step !== step) {
      await ctx.answerCallbackQuery('Сессия создания истекла');
      return null;
    }

    return { userId, state };
  }

  private isDiscipline(value: string): value is Discipline {
    return discipline.includes(value as Discipline);
  }

  private isTournamentFormat(value: string): value is TournamentFormat {
    return tournamentFormat.includes(value as TournamentFormat);
  }

  private isAllowedParticipantsCount(value: number): boolean {
    return [8, 16, 32, 64, 128].includes(value);
  }

  private isAllowedWinScore(value: number): boolean {
    return [2, 3, 4, 5].includes(value);
  }

  private hasRequiredCreationData(data: CreationData): data is CreationData & {
    name: string;
    discipline: Discipline;
    format: TournamentFormat;
    maxParticipants: number;
    winScore: number;
    venueId: string;
  } {
    return Boolean(
      data.name &&
      data.discipline &&
      data.format &&
      data.maxParticipants &&
      data.winScore &&
      data.venueId,
    );
  }
}

// #endregion
