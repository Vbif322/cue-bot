import { eq } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { tournaments } from '@/db/schema.js';
import { safeEditMessageText } from '@/utils/messageHelpers.js';
import { getMatch } from '@/services/matchService.js';
import { formatMatchCard, getMatchKeyboard } from '@/bot/ui/matchUI.js';
import { canManageTournament } from '@/bot/permissions.js';
import type { BotContext } from '@/bot/types.js';

/**
 * Re-render a match card in place (edit the current message): fetch the match
 * and its tournament, recompute the manage permission, and replace the message
 * text + keyboard. No-op if the match or its tournament can't be found. Pass
 * `extraText` to append a note (e.g. a dispute warning) under the card.
 *
 * Replaces the block that was copy-pasted into nearly every match callback
 * handler (getMatch → load tournament → formatMatchCard → getMatchKeyboard →
 * safeEditMessageText).
 */
export async function refreshMatchCard(
  ctx: BotContext,
  matchId: UUID,
  options: { extraText?: string } = {},
): Promise<void> {
  const match = await getMatch(matchId);
  if (!match) return;

  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, match.tournamentId),
  });
  if (!tournament) return;

  const canManage = await canManageTournament(ctx, match.tournamentId);
  const text = formatMatchCard(match, tournament) + (options.extraText ?? '');
  const keyboard = getMatchKeyboard(
    match,
    ctx.dbUser.id,
    tournament,
    canManage,
  );

  await safeEditMessageText(ctx, {
    text,
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}
