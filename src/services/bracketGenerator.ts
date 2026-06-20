import type { UUID } from 'crypto';

import type { Tournament } from '@/bot/@types/tournament.js';
import type { TournamentParticipant } from '@/bot/@types/tournament.js';

export interface BracketMatch {
  round: number;
  position: number;
  player1Id: UUID | null;
  player2Id: UUID | null;
  nextMatchId?: number; // Position of next match (will be converted to UUID after creation)
  nextMatchPosition?: 'player1' | 'player2'; // Which slot in next match
  bracketType: 'winners' | 'losers' | 'grand_final';
  losersNextMatchPosition?: number; // For double elimination - where loser goes
  losersNextMatchSlot?: 'player1' | 'player2'; // Which slot the loser drops into
  player1IsWalkover?: boolean;
  player2IsWalkover?: boolean;
  isCompletedWalkover?: boolean;
  walkoverWinnerId?: UUID | null;
}

type ParticipantSlot = TournamentParticipant | { isBye: true };

/**
 * Get nearest power of 2 >= n
 */
export function getNextPowerOfTwo(n: number): number {
  let power = 1;
  while (power < n) {
    power *= 2;
  }
  return power;
}

/**
 * Calculate number of rounds needed for single elimination
 */
export function calculateRounds(bracketSize: number): number {
  return Math.log2(bracketSize);
}

/**
 * Shuffle array using Fisher-Yates algorithm
 */
export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = shuffled[i];
    const b = shuffled[j];
    if (a === undefined || b === undefined) continue;
    shuffled[i] = b;
    shuffled[j] = a;
  }
  return shuffled;
}

/**
 * Generate standard seed positions for bracket
 * Seeds are placed so high seeds meet low seeds as late as possible
 * E.g., for 8 players: [1,8,4,5,2,7,3,6]
 */
export function generateSeedPositions(bracketSize: number): number[] {
  if (bracketSize === 2) {
    return [1, 2];
  }

  const halfSize = bracketSize / 2;
  const topHalf = generateSeedPositions(halfSize);

  const result: number[] = [];
  for (const seed of topHalf) {
    result.push(seed);
    result.push(bracketSize + 1 - seed);
  }

  return result;
}

/**
 * Generate Single Elimination bracket
 */
export function generateSingleEliminationBracket(
  participants: TournamentParticipant[],
  options?: { randomAdvancement?: boolean },
): BracketMatch[] {
  const bracketSize = getNextPowerOfTwo(participants.length);
  const totalRounds = calculateRounds(bracketSize);

  // Create null entries for BYEs
  const allSlots: (TournamentParticipant | null)[] = [];
  const seedPositions = generateSeedPositions(bracketSize);

  for (let i = 0; i < bracketSize; i++) {
    const seedPosition = seedPositions[i] ?? i + 1;
    if (seedPosition <= participants.length) {
      allSlots.push(participants[seedPosition - 1] ?? null);
    } else {
      allSlots.push(null); // BYE
    }
  }

  const matches: BracketMatch[] = [];
  let matchPosition = 1;

  // Generate Round 1 matches
  for (let i = 0; i < bracketSize / 2; i++) {
    const player1 = allSlots[i * 2];
    const player2 = allSlots[i * 2 + 1];

    // Calculate next match position
    const nextMatchPos = Math.ceil((i + 1) / 2) + bracketSize / 2;
    const isTopHalf = i % 2 === 0;
    const isFinal = totalRounds === 1;

    const matchData: BracketMatch = {
      round: 1,
      position: matchPosition,
      player1Id: player1?.userId ?? null,
      player2Id: player2?.userId ?? null,
      bracketType: 'winners',
    };

    if (!isFinal) {
      matchData.nextMatchId = nextMatchPos;
      matchData.nextMatchPosition = isTopHalf ? 'player1' : 'player2';
    }

    matches.push(matchData);
    matchPosition++;
  }

  // Generate subsequent rounds
  let matchesInPrevRound = bracketSize / 2;

  for (let round = 2; round <= totalRounds; round++) {
    const matchesInRound = matchesInPrevRound / 2;
    const roundStart = matchPosition; // first position of this round; matchPosition mutates in the inner loop

    for (let i = 0; i < matchesInRound; i++) {
      const isFinal = round === totalRounds;
      const nextMatchPos = isFinal
        ? undefined
        : roundStart + matchesInRound + Math.floor(i / 2);
      const isTopHalf = i % 2 === 0;

      const matchData: BracketMatch = {
        round,
        position: matchPosition,
        player1Id: null,
        player2Id: null,
        bracketType: 'winners',
      };

      if (!isFinal && nextMatchPos !== undefined) {
        matchData.nextMatchId = nextMatchPos;
        matchData.nextMatchPosition = isTopHalf ? 'player1' : 'player2';
      }

      matches.push(matchData);
      matchPosition++;
    }

    matchesInPrevRound = matchesInRound;
  }

  // Process BYEs - auto-advance the real player AND resolve the seat as a
  // completed walkover, so createMatches persists status 'completed' (mirrors
  // the double-elim walkover resolution pass). Standard seeding guarantees a
  // round-1 BYE always has exactly one real player, so no cascade is needed.
  for (const match of matches) {
    if (match.round === 1) {
      if (match.player1Id && !match.player2Id) {
        match.player2IsWalkover = true;
        match.isCompletedWalkover = true;
        match.walkoverWinnerId = match.player1Id;
        advanceToNextMatch(matches, match, match.player1Id);
      } else if (!match.player1Id && match.player2Id) {
        match.player1IsWalkover = true;
        match.isCompletedWalkover = true;
        match.walkoverWinnerId = match.player2Id;
        advanceToNextMatch(matches, match, match.player2Id);
      }
    }
  }

  // Random mode: drop deterministic routing so winners are placed into random
  // free slots of the next round at runtime. BYE winners are already seeded into
  // round 2 above; the remaining slots fill randomly, yielding random pairings.
  if (options?.randomAdvancement) {
    for (const m of matches) {
      delete m.nextMatchId;
      delete m.nextMatchPosition;
    }
  }

  return matches;
}

/**
 * Helper to advance player to next match
 */
function advanceToNextMatch(
  matches: BracketMatch[],
  currentMatch: BracketMatch,
  playerId: UUID,
): void {
  if (currentMatch.nextMatchId === undefined) return;

  const nextMatch = matches.find(
    (m) => m.position === currentMatch.nextMatchId,
  );
  if (!nextMatch) return;

  if (currentMatch.nextMatchPosition === 'player1') {
    nextMatch.player1Id = playerId;
  } else {
    nextMatch.player2Id = playerId;
  }
}

/**
 * Generate a generalized Double Elimination bracket for 8–128 participants with a
 * configurable "merge round" M (default 2).
 *
 * The losers bracket is a standard double-elimination losers bracket truncated
 * after it absorbs the losers of upper round M; its N/2^M survivors then merge
 * 1:1 with the N/2^M upper-bracket survivors into a single-elimination playoff.
 *
 *   - M = 2 (default) reproduces the historical scheme (a second chance only in
 *     rounds 1–2, then single elimination from the "Объединение" round on).
 *   - M = k (= log2(bracketSize)) is a full double elimination WITHOUT bracket
 *     reset: the merge degenerates to a single 1-vs-1 grand final.
 *
 * Round numbering: upper rounds 1..M and merge-playoff rounds M+1..k+1 are
 * bracketType 'winners'; losers-bracket rounds 1..2(M-1) are bracketType
 * 'losers' (odd = minor / play-down, even = major / absorbs an upper drop).
 * Positions are allocated in topological order (a match's position precedes
 * every match it feeds — winner and loser), so the gen-time walkover pass
 * resolves byes correctly.
 *
 * For non-power-of-two participant counts, empty seats are filled with walkovers
 * (auto-loss in both upper and lower bracket), spread via generateSeedPositions.
 */
export function generateDoubleEliminationBracket(
  participants: TournamentParticipant[],
  options?: { randomAdvancement?: boolean; mergeRound?: number },
): BracketMatch[] {
  if (participants.length < 8 || participants.length > 128) {
    throw new Error(
      `Double elimination поддерживает 8–128 участников. Текущее количество: ${String(participants.length)}`,
    );
  }

  const bracketSize = getNextPowerOfTwo(participants.length);
  const k = calculateRounds(bracketSize); // upper rounds to a single winner
  const mergeRound = Math.max(2, Math.min(options?.mergeRound ?? 2, k));

  const seedPositions = generateSeedPositions(bracketSize);
  const allSlots: (TournamentParticipant | null)[] = seedPositions.map((seed) =>
    seed <= participants.length ? participants[seed - 1] ?? null : null,
  );

  const allMatches: BracketMatch[] = [];
  let position = 1;

  // Logical round -> ordered match objects (sparse arrays keyed by round number).
  const upperRounds: BracketMatch[][] = [];
  const losersRounds: BracketMatch[][] = [];
  const mergeRounds: BracketMatch[][] = [];

  const need = <T>(v: T | undefined, msg: string): T => {
    if (v === undefined) throw new Error(msg);
    return v;
  };

  // Allocate the round-1 upper matches, seeding players (null seat => walkover).
  const allocUpperRound1 = (matchCount: number): BracketMatch[] => {
    const out: BracketMatch[] = [];
    for (let i = 0; i < matchCount; i++) {
      const p1 = allSlots[i * 2] ?? null;
      const p2 = allSlots[i * 2 + 1] ?? null;
      const match: BracketMatch = {
        round: 1,
        position,
        player1Id: p1?.userId ?? null,
        player2Id: p2?.userId ?? null,
        player1IsWalkover: p1 == null,
        player2IsWalkover: p2 == null,
        bracketType: 'winners',
      };
      allMatches.push(match);
      out.push(match);
      position++;
    }
    return out;
  };

  // Allocate empty matches (players arrive via advancement at runtime).
  const allocEmpty = (
    round: number,
    matchCount: number,
    bracketType: 'winners' | 'losers',
  ): BracketMatch[] => {
    const out: BracketMatch[] = [];
    for (let i = 0; i < matchCount; i++) {
      const match: BracketMatch = {
        round,
        position,
        player1Id: null,
        player2Id: null,
        bracketType,
      };
      allMatches.push(match);
      out.push(match);
      position++;
    }
    return out;
  };

  // === ALLOCATION (topological order) ===
  upperRounds[1] = allocUpperRound1(bracketSize / 2);
  losersRounds[1] = allocEmpty(1, bracketSize / 4, 'losers'); // LB minor_1

  for (let r = 2; r <= mergeRound; r++) {
    upperRounds[r] = allocEmpty(r, bracketSize / 2 ** r, 'winners');
    // LB major_(r-1) absorbs upper round r's losers.
    losersRounds[2 * (r - 1)] = allocEmpty(
      2 * (r - 1),
      bracketSize / 2 ** r,
      'losers',
    );
    if (r < mergeRound) {
      // LB minor_r plays down major_(r-1) winners.
      losersRounds[2 * r - 1] = allocEmpty(
        2 * r - 1,
        bracketSize / 2 ** (r + 1),
        'losers',
      );
    }
  }

  // Merge playoff: single elimination of N/2^(M-1) players, rounds M+1..k+1.
  for (let mr = mergeRound + 1; mr <= k + 1; mr++) {
    mergeRounds[mr] = allocEmpty(mr, bracketSize / 2 ** (mr - 1), 'winners');
  }

  // === WIRING ===
  const link = (
    from: BracketMatch,
    to: BracketMatch,
    slot: 'player1' | 'player2',
  ): void => {
    from.nextMatchId = to.position;
    from.nextMatchPosition = slot;
  };
  const linkLoser = (
    from: BracketMatch,
    to: BracketMatch,
    slot: 'player1' | 'player2',
  ): void => {
    from.losersNextMatchPosition = to.position;
    from.losersNextMatchSlot = slot;
  };

  // Winner paths: upper r -> upper r+1 (pairs).
  for (let r = 1; r < mergeRound; r++) {
    const cur = need(upperRounds[r], `upper round ${String(r)}`);
    const next = need(upperRounds[r + 1], `upper round ${String(r + 1)}`);
    cur.forEach((m, i) => {
      link(m, need(next[Math.floor(i / 2)], 'upper target'), i % 2 === 0 ? 'player1' : 'player2');
    });
  }
  // Upper round M -> merge round M+1 (1:1, as player1).
  {
    const cur = need(upperRounds[mergeRound], 'upper merge round');
    const next = need(mergeRounds[mergeRound + 1], 'first merge round');
    cur.forEach((m, i) => {
      link(m, need(next[i], 'merge target'), 'player1');
    });
  }

  // Losers paths within the lower bracket.
  for (let j = 1; j <= mergeRound - 1; j++) {
    const minor = need(losersRounds[2 * j - 1], `LB minor ${String(j)}`);
    const major = need(losersRounds[2 * j], `LB major ${String(j)}`);
    // minor_j -> major_j (1:1, as player1; player2 is reserved for the upper drop).
    minor.forEach((m, i) => {
      link(m, need(major[i], 'LB major target'), 'player1');
    });
    if (j < mergeRound - 1) {
      // major_j -> minor_(j+1) (pairs).
      const nextMinor = need(losersRounds[2 * (j + 1) - 1], `LB minor ${String(j + 1)}`);
      major.forEach((m, i) => {
        link(m, need(nextMinor[Math.floor(i / 2)], 'LB minor target'), i % 2 === 0 ? 'player1' : 'player2');
      });
    } else {
      // Final LB major -> merge round M+1 (1:1, as player2).
      const next = need(mergeRounds[mergeRound + 1], 'first merge round');
      major.forEach((m, i) => {
        link(m, need(next[i], 'merge target'), 'player2');
      });
    }
  }

  // Merge playoff: round mr -> round mr+1 (pairs); terminal round has no next.
  for (let mr = mergeRound + 1; mr < k + 1; mr++) {
    const cur = need(mergeRounds[mr], `merge round ${String(mr)}`);
    const next = need(mergeRounds[mr + 1], `merge round ${String(mr + 1)}`);
    cur.forEach((m, i) => {
      link(m, need(next[Math.floor(i / 2)], 'merge target'), i % 2 === 0 ? 'player1' : 'player2');
    });
  }

  // Loser drops from the upper bracket into the lower bracket.
  // Upper round 1 losers -> LB minor_1 (2 per match: odd index -> player1).
  {
    const cur = need(upperRounds[1], 'upper round 1');
    const target = need(losersRounds[1], 'LB minor 1');
    cur.forEach((m, i) => {
      linkLoser(m, need(target[Math.floor(i / 2)], 'LB drop target'), i % 2 === 0 ? 'player1' : 'player2');
    });
  }
  // Upper round r losers (2<=r<=M) -> LB major_(r-1) (1:1, as player2).
  for (let r = 2; r <= mergeRound; r++) {
    const cur = need(upperRounds[r], `upper round ${String(r)}`);
    const target = need(losersRounds[2 * (r - 1)], `LB major ${String(r - 1)}`);
    cur.forEach((m, i) => {
      linkLoser(m, need(target[i], 'LB drop target'), 'player2');
    });
  }
  // All LB matches and upper/merge rounds > M: losers are eliminated (no pointer).

  // === WALKOVER RESOLUTION PASS ===
  // Resolve fully-determined walkover matches at gen-time, classifying slots:
  //   REAL: playerNId !== null
  //   WALKOVER_BOUND: playerNId === null && playerNIsWalkover === true
  //   WAITING: playerNId === null && playerNIsWalkover === false
  // Run to a fixed point so a resolved walkover can cascade through the deeper
  // losers-bracket rounds regardless of allocation order. Mixed cases
  // (WAITING + WALKOVER_BOUND) are left for runtime detection in matchService.
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of allMatches) {
      if (match.isCompletedWalkover === true) continue;
      const slot1Real = match.player1Id !== null;
      const slot2Real = match.player2Id !== null;
      const slot1Walkover = match.player1IsWalkover === true;
      const slot2Walkover = match.player2IsWalkover === true;

      if (slot1Real && slot2Walkover) {
        const p1Id = match.player1Id;
        if (!p1Id) throw new Error('Expected player1Id to be non-null');
        match.isCompletedWalkover = true;
        match.walkoverWinnerId = p1Id;
        advanceToNextMatch(allMatches, match, p1Id);
        if (match.bracketType === 'winners') {
          markLoserSlotAsWalkover(allMatches, match);
        }
        changed = true;
      } else if (slot2Real && slot1Walkover) {
        const p2Id = match.player2Id;
        if (!p2Id) throw new Error('Expected player2Id to be non-null');
        match.isCompletedWalkover = true;
        match.walkoverWinnerId = p2Id;
        advanceToNextMatch(allMatches, match, p2Id);
        if (match.bracketType === 'winners') {
          markLoserSlotAsWalkover(allMatches, match);
        }
        changed = true;
      } else if (slot1Walkover && slot2Walkover) {
        match.isCompletedWalkover = true;
        match.walkoverWinnerId = null;
        markNextMatchSlotAsWalkover(allMatches, match);
        if (match.bracketType === 'winners') {
          markLoserSlotAsWalkover(allMatches, match);
        }
        changed = true;
      }
      // All other combinations (REAL+REAL, REAL+WAITING, WAITING+WAITING,
      // WAITING+WALKOVER_BOUND) are left for runtime.
    }
  }

  // For random advancement mode, the deterministic pointers were only needed
  // by the gen-time walkover pass above. Clear them so runtime advancement
  // goes through randomBracketAdvancement.placeIntoRandomFreeSlot instead.
  if (options?.randomAdvancement) {
    for (const m of allMatches) {
      delete m.nextMatchId;
      delete m.nextMatchPosition;
      delete m.losersNextMatchPosition;
      delete m.losersNextMatchSlot;
    }
  }

  return allMatches;
}

function markNextMatchSlotAsWalkover(
  matches: BracketMatch[],
  currentMatch: BracketMatch,
): void {
  if (currentMatch.nextMatchId === undefined) return;
  const nextMatch = matches.find((m) => m.position === currentMatch.nextMatchId);
  if (!nextMatch) return;
  if (currentMatch.nextMatchPosition === 'player1') {
    nextMatch.player1IsWalkover = true;
  } else {
    nextMatch.player2IsWalkover = true;
  }
}

// Reads the loser-drop slot stored by the generator (single source of truth,
// mirrored at runtime by matchService.loserTarget).
function markLoserSlotAsWalkover(
  matches: BracketMatch[],
  currentMatch: BracketMatch,
): void {
  if (currentMatch.losersNextMatchPosition === undefined) return;
  const losersMatch = matches.find(
    (m) => m.position === currentMatch.losersNextMatchPosition,
  );
  if (!losersMatch) return;

  if (currentMatch.losersNextMatchSlot === 'player1') {
    losersMatch.player1IsWalkover = true;
  } else {
    losersMatch.player2IsWalkover = true;
  }
}

/**
 * Main bracket generation function
 */
export function generateBracket(
  format: Tournament['format'],
  participants: TournamentParticipant[],
  randomAdvancement = false,
  mergeRound = 2,
): BracketMatch[] {
  if (participants.length < 2) {
    throw new Error('Минимум 2 участника для создания сетки');
  }

  switch (format) {
    case 'single_elimination':
      return generateSingleEliminationBracket(participants, {
        randomAdvancement,
      });
    case 'double_elimination':
      return generateDoubleEliminationBracket(participants, {
        randomAdvancement,
        mergeRound,
      });
    case 'round_robin':
      return generateRoundRobinMatches(participants);
    default:
      throw new Error(`Неподдерживаемый формат: ${String(format)}`);
  }
}

/**
 * Generate Round Robin matches (all vs all)
 */
export function generateRoundRobinMatches(
  participants: TournamentParticipant[],
): BracketMatch[] {
  const matches: BracketMatch[] = [];
  const n = participants.length;
  const shuffled = shuffleArray(participants);

  // Use circle algorithm for scheduling
  const players: ParticipantSlot[] = [...shuffled];

  const hasBye = n % 2 === 1;

  if (hasBye) {
    players.push({ isBye: true });
  }

  const totalPlayers = players.length;
  const rounds = totalPlayers - 1;
  const matchesPerRound = totalPlayers / 2;

  let matchPosition = 1;

  for (let round = 1; round <= rounds; round++) {
    for (let i = 0; i < matchesPerRound; i++) {
      const home = players[i];
      const away = players[totalPlayers - 1 - i];

      // Skip BYE matches or undefined
      if (!home || !away || 'isBye' in home || 'isBye' in away) {
        continue;
      }

      matches.push({
        round,
        position: matchPosition++,
        player1Id: home.userId,
        player2Id: away.userId,
        bracketType: 'winners',
      });
    }

    // Rotate players (keep first player fixed)
    const lastPlayer = players.pop();
    if (lastPlayer === undefined) break;
    players.splice(1, 0, lastPlayer);
  }

  return matches;
}

/**
 * Get bracket statistics
 */
export function getBracketStats(
  format: 'single_elimination' | 'double_elimination' | 'round_robin',
  participantsCount: number,
  mergeRound = 2,
): { totalMatches: number; totalRounds: number } {
  const bracketSize = getNextPowerOfTwo(participantsCount);

  switch (format) {
    case 'single_elimination':
      return {
        totalMatches: bracketSize - 1,
        totalRounds: calculateRounds(bracketSize),
      };
    case 'double_elimination': {
      const k = calculateRounds(bracketSize);
      const m = Math.max(2, Math.min(mergeRound, k));
      return {
        totalMatches: 2 * bracketSize - bracketSize / 2 ** m - 1,
        totalRounds: k + 1,
      };
    }
    case 'round_robin': {
      const n = participantsCount;
      return {
        totalMatches: (n * (n - 1)) / 2,
        totalRounds: n % 2 === 0 ? n - 1 : n,
      };
    }
    default:
      return { totalMatches: 0, totalRounds: 0 };
  }
}

/**
 * Get round name for display
 */
export function getRoundName(
  round: number,
  totalRounds: number,
  format: string,
  bracketType = 'winners',
  mergeRound = 2,
): string {
  if (format === 'round_robin') {
    return `Тур ${String(round)}`;
  }

  if (format === 'double_elimination') {
    if (bracketType === 'losers') {
      return `Нижняя сетка, раунд ${String(round)}`;
    }
    // Winners side has k+1 rounds: upper 1..M and merge playoff M+1..k+1.
    const k = totalRounds - 1;
    const m = Math.max(2, Math.min(mergeRound, k));
    if (round === totalRounds && m === k) return 'Гранд-финал';
    if (round === m + 1 && round !== totalRounds) return 'Объединение';
    // Name by the number of matches in the round.
    const matchCount =
      round <= m ? 2 ** (k - round) : 2 ** (k - round + 1);
    if (matchCount <= 1) return 'Финал';
    if (matchCount === 2) return 'Полуфинал';
    return `1/${String(matchCount)} финала`;
  }

  if (bracketType === 'losers') {
    return `Нижняя сетка, раунд ${String(round)}`;
  }

  if (bracketType === 'grand_final') {
    return 'Гранд-финал';
  }

  const roundsFromEnd = totalRounds - round;

  switch (roundsFromEnd) {
    case 0:
      return 'Финал';
    case 1:
      return 'Полуфинал';
    case 2:
      return 'Четвертьфинал';
    case 3:
      return '1/8 финала';
    case 4:
      return '1/16 финала';
    default:
      return `Раунд ${String(round)}`;
  }
}
