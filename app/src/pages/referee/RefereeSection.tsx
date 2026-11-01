// Раздел «Судья» (/referee/*) — грузится лениво, игроки его код не скачивают.
// Доступ: админ или судья хотя бы одного турнира; права на каждое действие
// всё равно проверяет сервер (/api/app/referee/*).
import { Navigate, Route, Routes } from 'react-router-dom';
import { useRefereeOverview } from '../../lib/useReferee.ts';
import { useMe } from '../../lib/useAuth.ts';
import { EmptyState, Loader } from '../../components/ui.tsx';
import RefereeHomePage from './RefereeHomePage.tsx';
import RefereeTournamentPage from './RefereeTournamentPage.tsx';
import RefereeMatchPage from './RefereeMatchPage.tsx';

export default function RefereeSection() {
  const { data: me } = useMe();
  const { data, isLoading } = useRefereeOverview();

  if (isLoading) return <Loader />;
  if (me?.user?.isAdmin !== true && (data?.tournaments.length ?? 0) === 0) {
    return (
      <EmptyState
        title="Нет турниров для судейства"
        hint="Раздел появится, когда администратор назначит вас судьёй предстоящего или идущего турнира."
      />
    );
  }

  return (
    <Routes>
      <Route index element={<RefereeHomePage />} />
      <Route path="t/:tournamentId" element={<RefereeTournamentPage />} />
      <Route path="m/:matchId" element={<RefereeMatchPage />} />
      <Route path="*" element={<Navigate to="/referee" replace />} />
    </Routes>
  );
}
