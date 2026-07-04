// Турниры игрока (GET /api/app/me/tournaments).
import { useQuery } from '@tanstack/react-query';
import { meApi } from '../lib/api.ts';
import TournamentCard from '../components/TournamentCard.tsx';
import { EmptyState, ErrorBox, Loader } from '../components/ui.tsx';

export default function MyTournamentsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['me', 'tournaments'],
    queryFn: () => meApi.tournaments(),
  });

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: 20, boxSizing: 'border-box' }}>
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Мои турниры</div>
      {error && <ErrorBox message={error.message} />}
      {isLoading && <Loader />}
      {!isLoading && (data?.length ?? 0) === 0 && (
        <EmptyState
          title="Вы пока не участвуете"
          hint="Найдите турнир в ленте и зарегистрируйтесь."
        />
      )}
      {!isLoading && data && data.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 14,
          }}
        >
          {data.map((t) => (
            <TournamentCard key={t.id} tournament={t} />
          ))}
        </div>
      )}
    </div>
  );
}
