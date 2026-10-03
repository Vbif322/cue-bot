import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { tournamentsApi } from '../lib/api.ts';
import type { ApiTable } from '../lib/api.ts';
import TournamentHeader from '../components/tournament-detail/TournamentHeader.tsx';
import TournamentInfoTab from '../components/tournament-detail/TournamentInfoTab.tsx';
import ParticipantsTab from '../components/tournament-detail/ParticipantsTab.tsx';
import MatchesTab from '../components/tournament-detail/MatchesTab.tsx';
import QueueTab from '../components/tournament-detail/QueueTab.tsx';
import StandingsTab from '../components/tournament-detail/StandingsTab.tsx';

type Tab = 'info' | 'participants' | 'standings' | 'matches' | 'queue';

const TAB_LABELS: Record<Tab, string> = {
  info: 'Информация',
  participants: 'Участники',
  standings: 'Таблица',
  matches: 'Матчи',
  queue: 'Очередь',
};

export default function TournamentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') ?? 'info') as Tab;
  const setActiveTab = (tab: Tab) =>
    setSearchParams({ tab }, { replace: true });

  const { data: tournament, isLoading } = useQuery({
    queryKey: ['tournament', id],
    queryFn: () => tournamentsApi.get(id!),
    enabled: !!id,
  });

  const { data: tournamentTables } = useQuery<ApiTable[]>({
    queryKey: ['tournament-tables', id],
    queryFn: () => tournamentsApi.tables(id!),
    enabled: !!id,
  });

  const { data: participants } = useQuery({
    queryKey: ['tournament-participants', id],
    queryFn: () => tournamentsApi.participants(id!),
    enabled:
      !!id &&
      (activeTab === 'participants' ||
        tournament?.status === 'registration_closed'),
  });

  if (isLoading || !tournament || !id) {
    return <div className="text-gray-500 text-sm">Загрузка...</div>;
  }

  // Formats that rank players in a table rather than a bracket.
  const hasStandings =
    tournament.format === 'groups_playoff' ||
    tournament.format === 'round_robin';
  // The table queue only drives auto-assignment in a running tournament;
  // per-match scheduling seats every match by hand.
  const hasQueue =
    tournament.status === 'in_progress' &&
    tournament.scheduleMode !== 'per_match';
  const tabs: Tab[] = [
    'info',
    'participants',
    ...(hasStandings ? (['standings'] as const) : []),
    'matches',
    ...(hasQueue ? (['queue'] as const) : []),
  ];

  const confirmedParticipants =
    participants?.filter((p) => p.status === 'confirmed') ?? [];
  const confirmedCount = confirmedParticipants.length;
  const seedCounts = new Map<number, number>();
  for (const p of confirmedParticipants) {
    if (p.seed != null) {
      seedCounts.set(p.seed, (seedCounts.get(p.seed) ?? 0) + 1);
    }
  }
  const hasInvalidSeeds = confirmedParticipants.some(
    (p) =>
      p.seed != null &&
      (p.seed < 1 ||
        p.seed > confirmedCount ||
        (seedCounts.get(p.seed) ?? 0) > 1),
  );

  return (
    <div>
      <TournamentHeader
        tournament={tournament}
        hasInvalidSeeds={hasInvalidSeeds}
      />

      {/* Scrolls sideways on narrow screens. The baseline is an inset shadow,
          not a border, so the active tab's underline covers it without the
          -mb-px overflow that a scroll container would clip. */}
      <div className="flex gap-1 mb-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden shadow-[inset_0_-1px_0_var(--color-gray-200)]">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`shrink-0 whitespace-nowrap px-3 md:px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === tab
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {activeTab === 'info' && (
        <TournamentInfoTab tournament={tournament} tables={tournamentTables} />
      )}
      {activeTab === 'participants' && (
        <ParticipantsTab tournamentId={id} tournament={tournament} />
      )}
      {activeTab === 'standings' && <StandingsTab tournament={tournament} />}
      {activeTab === 'matches' && <MatchesTab tournamentId={id} />}
      {activeTab === 'queue' && hasQueue && <QueueTab tournamentId={id} />}
    </div>
  );
}
