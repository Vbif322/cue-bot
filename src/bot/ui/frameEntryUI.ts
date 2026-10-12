import { InlineKeyboard } from 'grammy';
import type { UUID } from 'crypto';

import {
  winScoreForMatch,
  type FrameInput,
} from '../../services/matchService.js';
import type { Tournament } from '../@types/tournament.js';
import type { MatchWithPlayers } from '../@types/match.js';
import { formatPlayerName, type PlayerNameParts } from './matchUI.js';

export type FrameSlot = 'player1' | 'player2';

/**
 * Where the reporter is in the frame-entry prompt. Absent = typing the next
 * frame. `break` awaits a max-break number for frame `frameNumber` (`fromEdit`:
 * return to that frame's edit screen afterwards); `pick` chooses a frame to
 * edit; `edit` awaits a new score for frame `frameNumber`.
 */
export type FrameEntryMode =
  | { kind: 'break'; frameNumber: number; slot: FrameSlot; fromEdit: boolean }
  | { kind: 'pick' }
  | { kind: 'edit'; frameNumber: number };

/**
 * Persistent bot session of the snooker frame-by-frame entry. UI state only:
 * the frames themselves live in the DB draft (`saveMatchFrame`), shared with
 * the web forms, so leaving and re-entering loses nothing.
 * `promptChatId`/`promptMessageId` locate the editable prompt message.
 * (Sessions written before the draft switch also carry `frames` /
 * `awaitingBreak` — ignored.)
 */
export interface FrameReportState {
  matchId: UUID;
  mode?: FrameEntryMode | undefined;
  promptChatId: number;
  promptMessageId: number;
}

/** Frames-won counts derived from a frame list. */
export function tallyFrames(frames: FrameInput[]): { p1: number; p2: number } {
  let p1 = 0;
  let p2 = 0;
  for (const f of frames) {
    if (f.player1Points > f.player2Points) p1++;
    else if (f.player2Points > f.player1Points) p2++;
  }
  return { p1, p2 };
}

/** Whether the frames already decide the match. */
export function isFramesDecided(
  frames: FrameInput[],
  match: MatchWithPlayers,
  tournament: Tournament,
): boolean {
  const { p1, p2 } = tallyFrames(frames);
  return Math.max(p1, p2) >= winScoreForMatch(match, tournament);
}

/** Frame N (1-based) of the list, or undefined when out of range. */
export function frameAt(
  frames: FrameInput[],
  frameNumber: number,
): FrameInput | undefined {
  return frames[frameNumber - 1];
}

function frameLine(f: FrameInput): string {
  return `${String(f.player1Points)} : ${String(f.player2Points)}`;
}

const FRAMES_PER_ROW = 4;

/**
 * Build the frame-entry prompt (message text + control keyboard) from the
 * session mode and the current draft frames. Pure — the caller edits the
 * prompt message with it.
 */
export function buildFrameEntryView(
  state: FrameReportState,
  frames: FrameInput[],
  match: MatchWithPlayers,
  tournament: Tournament,
  errorLine?: string,
): { text: string; keyboard: InlineKeyboard } {
  const parts: Record<FrameSlot, PlayerNameParts> = {
    player1: {
      username: match.player1Username ?? null,
      name: match.player1Name,
      surname: match.player1Surname,
      telegramId: match.player1TelegramId,
    },
    player2: {
      username: match.player2Username ?? null,
      name: match.player2Name,
      surname: match.player2Surname,
      telegramId: match.player2TelegramId,
    },
  };
  const player1 = formatPlayerName(parts.player1);
  const player2 = formatPlayerName(parts.player2);
  const { p1, p2 } = tallyFrames(frames);
  const id = state.matchId;

  let text = `📝 *Внесение результата (по фреймам)*\n\n`;
  text += `${player1} vs ${player2}\n`;
  text += `Игра до: ${String(winScoreForMatch(match, tournament))} побед\n\n`;
  if (errorLine) text += `⚠️ ${errorLine}\n\n`;

  if (frames.length > 0) {
    text += `*Фреймы:*\n`;
    frames.forEach((f, i) => {
      let line = `${String(i + 1)}) ${frameLine(f)}`;
      const breaks: string[] = [];
      if (f.player1Break != null)
        breaks.push(`P1 брейк ${String(f.player1Break)}`);
      if (f.player2Break != null)
        breaks.push(`P2 брейк ${String(f.player2Break)}`);
      if (breaks.length) line += `  🎯 ${breaks.join(', ')}`;
      text += `${line}\n`;
    });
    text += `Счёт по фреймам: ${String(p1)} : ${String(p2)}\n\n`;
  }

  const keyboard = new InlineKeyboard();
  const breakButtons = (): void => {
    keyboard
      .text('🎯 Брейк P1', `match:frame:break:${id}:player1`)
      .text('🎯 Брейк P2', `match:frame:break:${id}:player2`)
      .row();
  };
  const mode = state.mode;

  if (mode?.kind === 'break') {
    // Non-linked name here: a tg:// link wrapped in bold renders as an odd
    // clickable label inside a plain instruction.
    const who = formatPlayerName(parts[mode.slot], { link: false });
    text += `Введите макс. брейк для *${who}* (фрейм ${String(mode.frameNumber)}) числом:`;
    keyboard.text('↩️ Назад', `match:frame:back:${id}`).row();
  } else if (mode?.kind === 'pick') {
    text += `Выберите фрейм, который нужно исправить:`;
    frames.forEach((f, i) => {
      const n = String(i + 1);
      keyboard.text(`${n}) ${frameLine(f)}`, `match:frame:edit:${id}:${n}`);
      if ((i + 1) % FRAMES_PER_ROW === 0) keyboard.row();
    });
    if (frames.length % FRAMES_PER_ROW !== 0) keyboard.row();
    keyboard.text('↩️ Назад', `match:frame:back:${id}`).row();
  } else if (mode?.kind === 'edit') {
    const f = frameAt(frames, mode.frameNumber);
    const current = f ? ` (${frameLine(f)})` : '';
    text += `*Фрейм ${String(mode.frameNumber)}*${current}. Отправьте новый счёт сообщением, например \`74-15\`, или укажите брейк кнопкой.`;
    breakButtons();
    keyboard.text('↩️ Назад', `match:frame:back:${id}`).row();
  } else {
    if (isFramesDecided(frames, match, tournament)) {
      text += `Счёт достигнут (${String(p1)} : ${String(p2)}). Добавьте макс. брейки при необходимости и нажмите «Завершить».`;
      keyboard.text('✅ Завершить', `match:frame:finish:${id}`).row();
    } else {
      text += `Отправьте счёт следующего фрейма сообщением, например \`74-15\` или \`74 15\``;
    }
    if (frames.length > 0) {
      keyboard
        .text('↩️ Отменить фрейм', `match:frame:undo:${id}`)
        .text('✏️ Изменить фрейм', `match:frame:pick:${id}`)
        .row();
      breakButtons();
    }
  }
  keyboard.text('⏸ Выйти', `match:frame:cancel:${id}`);

  return { text, keyboard };
}
