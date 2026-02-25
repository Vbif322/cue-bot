import type { Tournament } from "../bot/@types/tournament.js";
import type { TournamentParticipant } from "../bot/@types/tournament.js";

export interface BracketMatch {
  round: number;
  position: number;
  player1Id: string | null;
  player2Id: string | null;
  nextMatchId?: number; // Position of next match (will be converted to UUID after creation)
  nextMatchPosition?: "player1" | "player2"; // Which slot in next match
  bracketType: "winners" | "losers" | "grand_final";
  losersNextMatchPosition?: number; // For double elimination - where loser goes
}

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
    const temp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = temp;
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
): BracketMatch[] {
  const bracketSize = getNextPowerOfTwo(participants.length);
  const totalRounds = calculateRounds(bracketSize);

  // Assign seeds to shuffled participants (random seeding)
  // const seededParticipants = shuffled.map((p, index) => ({
  //   ...p,
  //   seed: index + 1,
  // }));

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
      bracketType: "winners",
    };

    if (!isFinal) {
      matchData.nextMatchId = nextMatchPos;
      matchData.nextMatchPosition = isTopHalf ? "player1" : "player2";
    }

    matches.push(matchData);
    matchPosition++;
  }

  // Generate subsequent rounds
  let matchesInPrevRound = bracketSize / 2;

  for (let round = 2; round <= totalRounds; round++) {
    const matchesInRound = matchesInPrevRound / 2;

    for (let i = 0; i < matchesInRound; i++) {
      const isFinal = round === totalRounds;
      const nextMatchPos = isFinal
        ? undefined
        : matchPosition + matchesInRound + Math.floor(i / 2);
      const isTopHalf = i % 2 === 0;

      const matchData: BracketMatch = {
        round,
        position: matchPosition,
        player1Id: null,
        player2Id: null,
        bracketType: "winners",
      };

      if (!isFinal && nextMatchPos !== undefined) {
        matchData.nextMatchId = nextMatchPos;
        matchData.nextMatchPosition = isTopHalf ? "player1" : "player2";
      }

      matches.push(matchData);
      matchPosition++;
    }

    matchesInPrevRound = matchesInRound;
  }

  // Process BYEs - auto-advance players with BYEs
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (!match) continue;
    if (match.round === 1) {
      // If one player is null (BYE), advance the other
      if (match.player1Id && !match.player2Id) {
        advanceToNextMatch(matches, match, match.player1Id);
      } else if (!match.player1Id && match.player2Id) {
        advanceToNextMatch(matches, match, match.player2Id);
      }
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
  playerId: string,
): void {
  if (currentMatch.nextMatchId === undefined) return;

  const nextMatch = matches.find(
    (m) => m.position === currentMatch.nextMatchId,
  );
  if (!nextMatch) return;

  if (currentMatch.nextMatchPosition === "player1") {
    nextMatch.player1Id = playerId;
  } else {
    nextMatch.player2Id = playerId;
  }
}

/**
 * Generate hybrid Double Elimination bracket for 16 participants.
 *
 * Structure:
 *   R1 upper (8 matches, pos 1-8)   → winners to R2 upper, losers to R1 lower
 *   R1 lower (4 matches, pos 9-12)  → winners to R2 lower, losers eliminated
 *   R2 upper (4 matches, pos 13-16) → winners to R3 merge, losers to R2 lower
 *   R2 lower (4 matches, pos 17-20) → winners to R3 merge, losers eliminated
 *   R3 merge (4 matches, pos 21-24) → winners to R4, losers eliminated
 *   R4 semi  (2 matches, pos 25-26) → winners to R5
 *   R5 final (1 match,   pos 27)    → champion
 *
 * Total: 27 matches
 */
export function generateDoubleEliminationBracket(
  participants: TournamentParticipant[],
): BracketMatch[] {
  if (participants.length !== 16) {
    throw new Error(
      "Double elimination поддерживает только 16 участников. " +
        `Текущее количество: ${participants.length}`,
    );
  }

  const shuffled = shuffleArray(participants);
  const allMatches: BracketMatch[] = [];

  // R1 upper: 8 matches (positions 1-8)
  for (let i = 0; i < 8; i++) {
    allMatches.push({
      round: 1,
      position: i + 1,
      player1Id: shuffled[i * 2]?.userId ?? null,
      player2Id: shuffled[i * 2 + 1]?.userId ?? null,
      bracketType: "winners",
    });
  }

  // R1 lower: 4 matches (positions 9-12) — filled by R1 upper losers
  for (let i = 0; i < 4; i++) {
    allMatches.push({
      round: 1,
      position: 9 + i,
      player1Id: null,
      player2Id: null,
      bracketType: "losers",
    });
  }

  // R2 upper: 4 matches (positions 13-16)
  for (let i = 0; i < 4; i++) {
    allMatches.push({
      round: 2,
      position: 13 + i,
      player1Id: null,
      player2Id: null,
      bracketType: "winners",
    });
  }

  // R2 lower: 4 matches (positions 17-20)
  for (let i = 0; i < 4; i++) {
    allMatches.push({
      round: 2,
      position: 17 + i,
      player1Id: null,
      player2Id: null,
      bracketType: "losers",
    });
  }

  // R3 merge: 4 matches (positions 21-24)
  for (let i = 0; i < 4; i++) {
    allMatches.push({
      round: 3,
      position: 21 + i,
      player1Id: null,
      player2Id: null,
      bracketType: "winners",
    });
  }

  // R4 semi: 2 matches (positions 25-26)
  for (let i = 0; i < 2; i++) {
    allMatches.push({
      round: 4,
      position: 25 + i,
      player1Id: null,
      player2Id: null,
      bracketType: "winners",
    });
  }

  // R5 final: 1 match (position 27)
  allMatches.push({
    round: 5,
    position: 27,
    player1Id: null,
    player2Id: null,
    bracketType: "winners",
  });

  // === WINNER PATHS (nextMatchId + nextMatchPosition) ===

  // R1 upper → R2 upper: pairs feed into one match
  for (let i = 0; i < 8; i++) {
    allMatches[i]!.nextMatchId = 13 + Math.floor(i / 2);
    allMatches[i]!.nextMatchPosition = i % 2 === 0 ? "player1" : "player2";
  }

  // R1 lower → R2 lower: each winner goes to own match as player1
  for (let i = 0; i < 4; i++) {
    allMatches[8 + i]!.nextMatchId = 17 + i;
    allMatches[8 + i]!.nextMatchPosition = "player1";
  }

  // R2 upper → R3 merge: as player1
  for (let i = 0; i < 4; i++) {
    allMatches[12 + i]!.nextMatchId = 21 + i;
    allMatches[12 + i]!.nextMatchPosition = "player1";
  }

  // R2 lower → R3 merge: as player2
  for (let i = 0; i < 4; i++) {
    allMatches[16 + i]!.nextMatchId = 21 + i;
    allMatches[16 + i]!.nextMatchPosition = "player2";
  }

  // R3 → R4
  for (let i = 0; i < 4; i++) {
    allMatches[20 + i]!.nextMatchId = 25 + Math.floor(i / 2);
    allMatches[20 + i]!.nextMatchPosition = i % 2 === 0 ? "player1" : "player2";
  }

  // R4 → R5
  for (let i = 0; i < 2; i++) {
    allMatches[24 + i]!.nextMatchId = 27;
    allMatches[24 + i]!.nextMatchPosition = i === 0 ? "player1" : "player2";
  }

  // === LOSER PATHS (losersNextMatchPosition) ===

  // R1 upper losers → R1 lower (2 losers per lower match)
  // Odd position → player1, even → player2
  for (let i = 0; i < 8; i++) {
    allMatches[i]!.losersNextMatchPosition = 9 + Math.floor(i / 2);
  }

  // R2 upper losers → R2 lower (each to own match, as player2)
  for (let i = 0; i < 4; i++) {
    allMatches[12 + i]!.losersNextMatchPosition = 17 + i;
  }

  // R1 lower, R2 lower, R3+ losers → eliminated (no losersNextMatchPosition)

  return allMatches;
}

/**
 * Main bracket generation function
 */
export function generateBracket(
  format: Tournament["format"],
  participants: TournamentParticipant[],
): BracketMatch[] {
  if (participants.length < 2) {
    throw new Error("Минимум 2 участника для создания сетки");
  }

  switch (format) {
    case "single_elimination":
      return generateSingleEliminationBracket(participants);
    case "double_elimination":
      return generateDoubleEliminationBracket(participants);
    case "round_robin":
      return generateRoundRobinMatches(participants);
    default:
      throw new Error(`Неподдерживаемый формат: ${format}`);
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
  const players = [...shuffled];
  const hasBye = n % 2 === 1;
  if (hasBye) {
    players.push({
      userId: "BYE",
      username: null,
      name: null,
      seed: null,
    } as TournamentParticipant);
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
      if (!home || !away || home.userId === "BYE" || away.userId === "BYE") {
        continue;
      }

      matches.push({
        round,
        position: matchPosition++,
        player1Id: home.userId,
        player2Id: away.userId,
        bracketType: "winners",
      });
    }

    // Rotate players (keep first player fixed)
    const lastPlayer = players.pop()!;
    players.splice(1, 0, lastPlayer);
  }

  return matches;
}

/**
 * Get bracket statistics
 */
export function getBracketStats(
  format: "single_elimination" | "double_elimination" | "round_robin",
  participantsCount: number,
): { totalMatches: number; totalRounds: number } {
  const bracketSize = getNextPowerOfTwo(participantsCount);

  switch (format) {
    case "single_elimination":
      return {
        totalMatches: bracketSize - 1,
        totalRounds: calculateRounds(bracketSize),
      };
    case "double_elimination":
      return {
        totalMatches: 27,
        totalRounds: 5,
      };
    case "round_robin":
      const n = participantsCount;
      return {
        totalMatches: (n * (n - 1)) / 2,
        totalRounds: n % 2 === 0 ? n - 1 : n,
      };
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
  bracketType: string = "winners",
): string {
  if (format === "round_robin") {
    return `Тур ${round}`;
  }

  if (format === "double_elimination") {
    if (bracketType === "losers") {
      if (round === 1) return "Нижняя сетка, раунд 1";
      if (round === 2) return "Нижняя сетка, раунд 2";
      return `Нижняя сетка, раунд ${round}`;
    }
    if (round === 1) return "1/8 финала";
    if (round === 2) return "1/4 финала";
    if (round === 3) return "Объединение";
    if (round === 4) return "Полуфинал";
    if (round === 5) return "Финал";
    return `Раунд ${round}`;
  }

  if (bracketType === "losers") {
    return `Нижняя сетка, раунд ${round}`;
  }

  if (bracketType === "grand_final") {
    return "Гранд-финал";
  }

  const roundsFromEnd = totalRounds - round;

  switch (roundsFromEnd) {
    case 0:
      return "Финал";
    case 1:
      return "Полуфинал";
    case 2:
      return "Четвертьфинал";
    case 3:
      return "1/8 финала";
    case 4:
      return "1/16 финала";
    default:
      return `Раунд ${round}`;
  }
}
