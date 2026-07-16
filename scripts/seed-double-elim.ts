/**
 * Seed script: creates a test double elimination tournament with 16 mock participants.
 *
 * Two modes:
 *   tsx --env-file=.env scripts/seed-double-elim.ts
 *     Full demo: seeds → bracket → matches → in_progress (a ready-to-play bracket).
 *
 *   tsx --env-file=.env scripts/seed-double-elim.ts --registration
 *     Stops at the registration stage: a `registration_open` tournament with 16
 *     confirmed mock participants and no bracket/matches. Use it to swap mock
 *     participants for your own accounts in the admin panel, then close
 *     registration and start the tournament yourself. Re-running first wipes the
 *     previous registration tournament with the same name, so it is safe to repeat.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../src/db/schema.js';
import { eq, and, inArray, asc } from 'drizzle-orm';
import { generateBracket } from '../src/services/bracketGenerator.js';
import { createMatches } from '../src/services/matchService.js';
import { shuffleArray } from '../src/services/bracketGenerator.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error(
    'DATABASE_URL is not set. Run with: tsx --env-file=.env scripts/seed-double-elim.ts',
  );
  process.exit(1);
}

const db = drizzle(DATABASE_URL, { schema });

const MOCK_PLAYERS = [
  { username: 'mock_player_1', name: 'Алекс', surname: 'Иванов' },
  { username: 'mock_player_2', name: 'Борис', surname: 'Петров' },
  { username: 'mock_player_3', name: 'Виктор', surname: 'Сидоров' },
  { username: 'mock_player_4', name: 'Григорий', surname: 'Козлов' },
  { username: 'mock_player_5', name: 'Дмитрий', surname: 'Новиков' },
  { username: 'mock_player_6', name: 'Евгений', surname: 'Морозов' },
  { username: 'mock_player_7', name: 'Жан', surname: 'Волков' },
  { username: 'mock_player_8', name: 'Захар', surname: 'Алексеев' },
  { username: 'mock_player_9', name: 'Игорь', surname: 'Лебедев' },
  { username: 'mock_player_10', name: 'Кирилл', surname: 'Семёнов' },
  { username: 'mock_player_11', name: 'Лев', surname: 'Егоров' },
  { username: 'mock_player_12', name: 'Максим', surname: 'Павлов' },
  { username: 'mock_player_13', name: 'Никита', surname: 'Козлов' },
  { username: 'mock_player_14', name: 'Олег', surname: 'Степанов' },
  { username: 'mock_player_15', name: 'Павел', surname: 'Николаев' },
  { username: 'mock_player_16', name: 'Роман', surname: 'Орлов' },
];

const REGISTRATION_TOURNAMENT_NAME = 'Test Registration (16 mock)';
const ADMIN_BASE_URL = (
  process.env.DEV_LOGIN_URL ?? 'http://localhost:5173'
).replace(/\/$/, '');

async function main() {
  const registrationOnly = process.argv.includes('--registration');

  console.log(
    registrationOnly
      ? '=== Seed: Registration-stage Test Tournament (16 mock) ===\n'
      : '=== Seed: Double Elimination Test Tournament ===\n',
  );

  // 1. Upsert 16 mock users
  console.log('1. Creating mock users...');
  const createdUsers: { id: string }[] = [];
  for (let i = 0; i < MOCK_PLAYERS.length; i++) {
    const player = MOCK_PLAYERS[i]!;
    const telegramId = `mock_tg_${i + 1}`;

    const existing = await db.query.users.findFirst({
      where: eq(schema.users.telegram_id, telegramId),
    });

    if (existing) {
      createdUsers.push(existing);
      console.log(`   [exists] ${player.username} (${existing.id})`);
    } else {
      const [user] = await db
        .insert(schema.users)
        .values({
          telegram_id: telegramId,
          username: player.username,
          name: player.name,
          surname: player.surname,
        })
        .returning({ id: schema.users.id });
      if (!user) throw new Error(`Failed to create user ${player.username}`);
      createdUsers.push(user);
      console.log(`   [created] ${player.username} (${user.id})`);
    }
  }

  const adminUserId = createdUsers[0]!.id;

  // 2. Upsert test venue
  console.log('\n2. Creating test venue...');
  let venue = await db.query.venues.findFirst({
    where: eq(schema.venues.name, 'Test Venue'),
  });
  if (!venue) {
    const [created] = await db
      .insert(schema.venues)
      .values({ name: 'Test Venue', address: 'Test Address' })
      .returning();
    venue = created;
  }
  if (!venue) throw new Error('Failed to create venue');
  console.log(`   Venue: "${venue.name}" (${venue.id})`);

  // 3. Create tournament
  console.log('\n3. Creating tournament...');
  if (registrationOnly) {
    // Wipe any previous registration tournament with the same name so repeated
    // runs don't pile up duplicates (cascades participants).
    await db
      .delete(schema.tournaments)
      .where(eq(schema.tournaments.name, REGISTRATION_TOURNAMENT_NAME));
  }
  const [tournament] = await db
    .insert(schema.tournaments)
    .values({
      name: registrationOnly
        ? REGISTRATION_TOURNAMENT_NAME
        : 'Test Double Elimination',
      description: 'Тестовый турнир с моковыми участниками',
      format: 'double_elimination',
      sport: 'snooker',
      discipline: 'snooker_15_red',
      maxParticipants: 16,
      winScore: 3,
      createdBy: adminUserId,
      venueId: venue.id,
      visibility: 'public',
      status: registrationOnly ? 'registration_open' : 'registration_closed',
      // Registration-open leaves confirmedParticipants null (frozen only when
      // registration is closed); the full demo jumps straight to the closed count.
      confirmedParticipants: registrationOnly ? null : 16,
    })
    .returning();

  if (!tournament) throw new Error('Failed to create tournament');
  console.log(`   Created: "${tournament.name}" (${tournament.id})`);

  // 4. Add all 16 users as confirmed participants
  console.log('\n4. Adding participants...');
  for (const user of createdUsers) {
    await db
      .insert(schema.tournamentParticipants)
      .values({
        tournamentId: tournament.id,
        userId: user.id,
        status: 'confirmed',
      })
      .onConflictDoNothing();
  }
  console.log(`   Added ${createdUsers.length} participants`);

  // Registration mode stops here: no seeds, no bracket, no matches. The
  // tournament stays open for registration so you can swap mock participants
  // for your own accounts in the admin panel, then close & start it yourself.
  if (registrationOnly) {
    console.log(`\n=== Done! (registration stage) ===`);
    console.log(`Tournament ID: ${tournament.id}`);
    console.log(`Status:        registration_open`);
    console.log(`Participants:  16 confirmed (mock)`);
    console.log(`\nOpen in admin panel: ${ADMIN_BASE_URL}/tournaments/${tournament.id}`);
    console.log(
      '\nNext: delete a mock participant and add your own account on the ' +
        'tournament page, then close registration and start the tournament.',
    );
    process.exit(0);
  }

  // 5. Assign random seeds
  console.log('\n5. Assigning seeds...');
  const participants = await db
    .select({
      userId: schema.tournamentParticipants.userId,
      username: schema.users.username,
      name: schema.users.name,
      seed: schema.tournamentParticipants.seed,
      createdAt: schema.tournamentParticipants.createdAt,
    })
    .from(schema.tournamentParticipants)
    .innerJoin(
      schema.users,
      eq(schema.tournamentParticipants.userId, schema.users.id),
    )
    .where(
      and(
        eq(schema.tournamentParticipants.tournamentId, tournament.id),
        inArray(schema.tournamentParticipants.status, ['pending', 'confirmed']),
      ),
    )
    .orderBy(asc(schema.tournamentParticipants.createdAt));

  const shuffled = shuffleArray(participants);
  for (let i = 0; i < shuffled.length; i++) {
    const p = shuffled[i]!;
    await db
      .update(schema.tournamentParticipants)
      .set({ seed: i + 1 })
      .where(
        and(
          eq(schema.tournamentParticipants.tournamentId, tournament.id),
          eq(schema.tournamentParticipants.userId, p.userId),
        ),
      );
  }
  console.log('   Seeds assigned');

  // 6. Generate bracket and create matches
  console.log('\n6. Generating bracket and creating matches...');
  const participantsForBracket = shuffled.map((p, i) => ({
    userId: p.userId,
    username: p.username,
    name: p.name,
    seed: i + 1,
  }));

  const bracket = generateBracket('double_elimination', participantsForBracket);
  await createMatches(tournament.id, bracket);
  console.log(`   Created ${bracket.length} matches`);

  // 7. Set tournament status to in_progress
  console.log('\n7. Starting tournament...');
  await db
    .update(schema.tournaments)
    .set({ status: 'in_progress', updatedAt: new Date() })
    .where(eq(schema.tournaments.id, tournament.id));

  console.log(`\n=== Done! ===`);
  console.log(`Tournament ID: ${tournament.id}`);
  console.log(`Participants:  16`);
  console.log(`Matches:       ${bracket.length}`);
  console.log(`\nOpen admin panel to view the bracket.`);

  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
