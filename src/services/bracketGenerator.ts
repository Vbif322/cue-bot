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
 * Generate hybrid Double Elimination bracket for 8–16 participants.
 *
 * Structure (always 27 matches, fixed slots):
 *   R1 upper (8 matches, pos 1-8)   → winners to R2 upper, losers to R1 lower
 *   R1 lower (4 matches, pos 9-12)  → winners to R2 lower, losers eliminated
 *   R2 upper (4 matches, pos 13-16) → winners to R3 merge, losers to R2 lower
 *   R2 lower (4 matches, pos 17-20) → winners to R3 merge, losers eliminated
 *   R3 merge (4 matches, pos 21-24) → winners to R4, losers eliminated
 *   R4 semi  (2 matches, pos 25-26) → winners to R5
 *   R5 final (1 match,   pos 27)    → champion
 *
 * For <16 participants: empty slots are filled with walkover (auto-loss in
 * upper AND lower bracket). Distribution is via generateSeedPositions so
 * walkovers spread evenly across the bracket.
 */
export function generateDoubleEliminationBracket(
  participants: TournamentParticipant[],
  options?: { randomAdvancement?: boolean },
): BracketMatch[] {
  if (participants.length < 8 || participants.length > 16) {
    throw new Error(
      `Double elimination поддерживает 8–16 участников. Текущее количество: ${String(participants.length)}`,
    );
  }

  const seedPositions = generateSeedPositions(16);
  const allSlots: (TournamentParticipant | null)[] = seedPositions.map(
    (seed) =>
      seed <= participants.length ? participants[seed - 1] ?? null : null,
  );

  const allMatches: BracketMatch[] = [];

  // R1 upper: 8 matches (positions 1-8)
  for (let i = 0; i < 8; i++) {
    const p1 = allSlots[i * 2];
    const p2 = allSlots[i * 2 + 1];
    allMatches.push({
      round: 1,
      position: i + 1,
      player1Id: p1?.userId ?? null,
      player2Id: p2?.userId ?? null,
      player1IsWalkover: p1 == null,
      player2IsWalkover: p2 == null,
      bracketType: 'winners',
    });
  }

  // R1 lower: 4 matches (positions 9-12) — filled by R1 upper losers
  for (let i = 0; i < 4; i++) {
    allMatches.push({
      round: 1,
      position: 9 + i,
      player1Id: null,
      player2Id: null,
      bracketType: 'losers',
    });
  }

  // R2 upper: 4 matches (positions 13-16)
  for (let i = 0; i < 4; i++) {
    allMatches.push({
      round: 2,
      position: 13 + i,
      player1Id: null,
      player2Id: null,
      bracketType: 'winners',
    });
  }

  // R2 lower: 4 matches (positions 17-20)
  for (let i = 0; i < 4; i++) {
    allMatches.push({
      round: 2,
      position: 17 + i,
      player1Id: null,
      player2Id: null,
      bracketType: 'losers',
    });
  }

  // R3 merge: 4 matches (positions 21-24)
  for (let i = 0; i < 4; i++) {
    allMatches.push({
      round: 3,
      position: 21 + i,
      player1Id: null,
      player2Id: null,
      bracketType: 'winners',
    });
  }

  // R4 semi: 2 matches (positions 25-26)
  for (let i = 0; i < 2; i++) {
    allMatches.push({
      round: 4,
      position: 25 + i,
      player1Id: null,
      player2Id: null,
      bracketType: 'winners',
    });
  }

  // R5 final: 1 match (position 27)
  allMatches.push({
    round: 5,
    position: 27,
    player1Id: null,
    player2Id: null,
    bracketType: 'winners',
  });

  // === WINNER PATHS (nextMatchId + nextMatchPosition) ===

  // R1 upper → R2 upper: pairs feed into one match
  for (let i = 0; i < 8; i++) {
    const m = allMatches[i];
    if (!m) throw new Error(`Missing allMatches[${String(i)}]`);
    m.nextMatchId = 13 + Math.floor(i / 2);
    m.nextMatchPosition = i % 2 === 0 ? 'player1' : 'player2';
  }

  // R1 lower → R2 lower: each winner goes to own match as player1
  for (let i = 0; i < 4; i++) {
    const m = allMatches[8 + i];
    if (!m) throw new Error(`Missing allMatches[${String(8 + i)}]`);
    m.nextMatchId = 17 + i;
    m.nextMatchPosition = 'player1';
  }

  // R2 upper → R3 merge: as player1
  for (let i = 0; i < 4; i++) {
    const m = allMatches[12 + i];
    if (!m) throw new Error(`Missing allMatches[${String(12 + i)}]`);
    m.nextMatchId = 21 + i;
    m.nextMatchPosition = 'player1';
  }

  // R2 lower → R3 merge: as player2
  for (let i = 0; i < 4; i++) {
    const m = allMatches[16 + i];
    if (!m) throw new Error(`Missing allMatches[${String(16 + i)}]`);
    m.nextMatchId = 21 + i;
    m.nextMatchPosition = 'player2';
  }

  // R3 → R4
  for (let i = 0; i < 4; i++) {
    const m = allMatches[20 + i];
    if (!m) throw new Error(`Missing allMatches[${String(20 + i)}]`);
    m.nextMatchId = 25 + Math.floor(i / 2);
    m.nextMatchPosition = i % 2 === 0 ? 'player1' : 'player2';
  }

  // R4 → R5
  for (let i = 0; i < 2; i++) {
    const m = allMatches[24 + i];
    if (!m) throw new Error(`Missing allMatches[${String(24 + i)}]`);
    m.nextMatchId = 27;
    m.nextMatchPosition = i === 0 ? 'player1' : 'player2';
  }

  // === LOSER PATHS (losersNextMatchPosition) ===

  // R1 upper losers → R1 lower (2 losers per lower match)
  // Odd position → player1, even → player2
  for (let i = 0; i < 8; i++) {
    const m = allMatches[i];
    if (!m) throw new Error(`Missing allMatches[${String(i)}]`);
    m.losersNextMatchPosition = 9 + Math.floor(i / 2);
  }

  // R2 upper losers → R2 lower (each to own match, as player2)
  for (let i = 0; i < 4; i++) {
    const m = allMatches[12 + i];
    if (!m) throw new Error(`Missing allMatches[${String(12 + i)}]`);
    m.losersNextMatchPosition = 17 + i;
  }

  // R1 lower, R2 lower, R3+ losers → eliminated (no losersNextMatchPosition)

  // === WALKOVER RESOLUTION PASS ===
  // Process matches in position order. For each match, classify slot states:
  //   REAL: playerNId !== null
  //   WALKOVER_BOUND: playerNId === null && playerNIsWalkover === true
  //   WAITING: playerNId === null && playerNIsWalkover === false
  // and resolve fully-determined walkover matches at gen-time. Mixed cases
  // (WAITING + WALKOVER_BOUND) are left for runtime detection in matchService.
  for (const match of allMatches) {
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
    } else if (slot2Real && slot1Walkover) {
      const p2Id = match.player2Id;
      if (!p2Id) throw new Error('Expected player2Id to be non-null');
      match.isCompletedWalkover = true;
      match.walkoverWinnerId = p2Id;
      advanceToNextMatch(allMatches, match, p2Id);
      if (match.bracketType === 'winners') {
        markLoserSlotAsWalkover(allMatches, match);
      }
    } else if (slot1Walkover && slot2Walkover) {
      match.isCompletedWalkover = true;
      match.walkoverWinnerId = null;
      markNextMatchSlotAsWalkover(allMatches, match);
      if (match.bracketType === 'winners') {
        markLoserSlotAsWalkover(allMatches, match);
      }
    }
    // All other combinations (REAL+REAL, REAL+WAITING, WAITING+WAITING,
    // WAITING+WALKOVER_BOUND) are left for runtime.
  }

  // For random advancement mode, the deterministic pointers were only needed
  // by the gen-time walkover pass above. Clear them so runtime advancement
  // goes through randomBracketAdvancement.placeIntoRandomFreeSlot instead.
  if (options?.randomAdvancement) {
    for (const m of allMatches) {
      delete m.nextMatchId;
      delete m.nextMatchPosition;
      delete m.losersNextMatchPosition;
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

// Slot formula must stay in sync with matchService.advanceLoserToLosersBracket
function markLoserSlotAsWalkover(
  matches: BracketMatch[],
  currentMatch: BracketMatch,
): void {
  if (currentMatch.losersNextMatchPosition === undefined) return;
  const losersMatch = matches.find(
    (m) => m.position === currentMatch.losersNextMatchPosition,
  );
  if (!losersMatch) return;

  const slot: 'player1' | 'player2' =
    currentMatch.round === 1
      ? currentMatch.position % 2 === 1
        ? 'player1'
        : 'player2'
      : 'player2';

  if (slot === 'player1') {
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
): { totalMatches: number; totalRounds: number } {
  const bracketSize = getNextPowerOfTwo(participantsCount);

  switch (format) {
    case 'single_elimination':
      return {
        totalMatches: bracketSize - 1,
        totalRounds: calculateRounds(bracketSize),
      };
    case 'double_elimination':
      return {
        totalMatches: 27,
        totalRounds: 5,
      };
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
): string {
  if (format === 'round_robin') {
    return `Тур ${String(round)}`;
  }

  if (format === 'double_elimination') {
    if (bracketType === 'losers') {
      if (round === 1) return 'Нижняя сетка, раунд 1';
      if (round === 2) return 'Нижняя сетка, раунд 2';
      return `Нижняя сетка, раунд ${String(round)}`;
    }
    if (round === 1) return '1/8 финала';
    if (round === 2) return '1/4 финала';
    if (round === 3) return 'Объединение';
    if (round === 4) return 'Полуфинал';
    if (round === 5) return 'Финал';
    return `Раунд ${String(round)}`;
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
