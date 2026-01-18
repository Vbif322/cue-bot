import type { TournamentParticipant } from "./tournamentService.js";

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
  if (bracketSize === 2) return [1, 2];

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
  participants: TournamentParticipant[]
): BracketMatch[] {
  const shuffled = shuffleArray(participants);
  const bracketSize = getNextPowerOfTwo(shuffled.length);
  const totalRounds = calculateRounds(bracketSize);

  // Assign seeds to shuffled participants (random seeding)
  const seededParticipants = shuffled.map((p, index) => ({
    ...p,
    seed: index + 1,
  }));

  // Create null entries for BYEs
  const allSlots: (TournamentParticipant | null)[] = [];
  const seedPositions = generateSeedPositions(bracketSize);

  for (let i = 0; i < bracketSize; i++) {
    const seedPosition = seedPositions[i] ?? i + 1;
    if (seedPosition <= shuffled.length) {
      allSlots.push(seededParticipants[seedPosition - 1] ?? null);
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

    matches.push({
      round: 1,
      position: matchPosition,
      player1Id: player1?.userId ?? null,
      player2Id: player2?.userId ?? null,
      nextMatchId: nextMatchPos,
      nextMatchPosition: isTopHalf ? "player1" : "player2",
      bracketType: "winners",
    });
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
  playerId: string
): void {
  if (currentMatch.nextMatchId === undefined) return;

  const nextMatch = matches.find((m) => m.position === currentMatch.nextMatchId);
  if (!nextMatch) return;

  if (currentMatch.nextMatchPosition === "player1") {
    nextMatch.player1Id = playerId;
  } else {
    nextMatch.player2Id = playerId;
  }
}

/**
 * Generate Double Elimination bracket
 */
export function generateDoubleEliminationBracket(
  participants: TournamentParticipant[]
): BracketMatch[] {
  const shuffled = shuffleArray(participants);
  const bracketSize = getNextPowerOfTwo(shuffled.length);
  const winnersRounds = calculateRounds(bracketSize);

  // Start with winners bracket (same as single elimination)
  const winnersMatches = generateSingleEliminationBracket(shuffled);
  const matches: BracketMatch[] = [...winnersMatches];

  let matchPosition = matches.length + 1;

  // Calculate losers bracket structure
  // Losers bracket has (2 * winnersRounds - 1) rounds
  const losersRounds = 2 * winnersRounds - 1;

  // In each losers round:
  // - Odd rounds: losers from winners bracket drop in
  // - Even rounds: only losers bracket participants play

  const losersMatchesByRound: BracketMatch[][] = [];

  // First losers round: losers from winners R1
  const firstRoundMatches = bracketSize / 4;
  const losersR1: BracketMatch[] = [];

  for (let i = 0; i < firstRoundMatches; i++) {
    losersR1.push({
      round: 1,
      position: matchPosition++,
      player1Id: null,
      player2Id: null,
      bracketType: "losers",
    });
  }
  losersMatchesByRound.push(losersR1);

  // Continue losers bracket rounds
  let prevRoundMatches = firstRoundMatches;

  for (let round = 2; round <= losersRounds; round++) {
    const isDropInRound = round % 2 === 1;
    const currentMatches = isDropInRound ? prevRoundMatches : prevRoundMatches / 2;

    const roundMatches: BracketMatch[] = [];
    for (let i = 0; i < currentMatches; i++) {
      roundMatches.push({
        round,
        position: matchPosition++,
        player1Id: null,
        player2Id: null,
        bracketType: "losers",
      });
    }
    losersMatchesByRound.push(roundMatches);

    if (!isDropInRound) {
      prevRoundMatches = currentMatches;
    }
  }

  // Add all losers matches
  for (const roundMatches of losersMatchesByRound) {
    matches.push(...roundMatches);
  }

  // Grand Final
  matches.push({
    round: winnersRounds + 1,
    position: matchPosition++,
    player1Id: null, // Winner of winners bracket
    player2Id: null, // Winner of losers bracket
    bracketType: "grand_final",
  });

  // Link winners bracket losers to losers bracket
  // This is a simplified version - real implementation would need proper linking
  for (const match of winnersMatches) {
    if (match.round === 1) {
      // Losers from R1 go to Losers R1
      const losersMatchIndex = Math.floor((match.position - 1) / 2);
      if (losersMatchesByRound[0] && losersMatchesByRound[0][losersMatchIndex]) {
        match.losersNextMatchPosition = losersMatchesByRound[0][losersMatchIndex].position;
      }
    }
  }

  return matches;
}

/**
 * Main bracket generation function
 */
export function generateBracket(
  format: "single_elimination" | "double_elimination" | "round_robin",
  participants: TournamentParticipant[]
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
  participants: TournamentParticipant[]
): BracketMatch[] {
  const matches: BracketMatch[] = [];
  const n = participants.length;
  const shuffled = shuffleArray(participants);

  // Use circle algorithm for scheduling
  const players = [...shuffled];
  const hasBye = n % 2 === 1;
  if (hasBye) {
    players.push({ userId: "BYE", username: null, name: null, seed: null } as TournamentParticipant);
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
  participantsCount: number
): { totalMatches: number; totalRounds: number } {
  const bracketSize = getNextPowerOfTwo(participantsCount);

  switch (format) {
    case "single_elimination":
      return {
        totalMatches: bracketSize - 1,
        totalRounds: calculateRounds(bracketSize),
      };
    case "double_elimination":
      // Winners: bracketSize - 1
      // Losers: bracketSize - 1
      // Grand Final: 1 (potentially 2 with reset)
      return {
        totalMatches: 2 * bracketSize - 1,
        totalRounds: calculateRounds(bracketSize) * 2 + 1,
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
  bracketType: string = "winners"
): string {
  if (format === "round_robin") {
    return `Тур ${round}`;
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
