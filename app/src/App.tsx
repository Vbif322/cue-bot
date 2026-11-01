import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useThemeSync } from './lib/theme.ts';
import Layout from './components/Layout.tsx';
import RequireAuth from './components/RequireAuth.tsx';
import LoginPage from './pages/LoginPage.tsx';
import FeedPage from './pages/FeedPage.tsx';
import TournamentPage from './pages/TournamentPage.tsx';
import BracketPage from './pages/BracketPage.tsx';
import MyTournamentsPage from './pages/MyTournamentsPage.tsx';
import MyMatchesPage from './pages/MyMatchesPage.tsx';
import ProfilePage from './pages/ProfilePage.tsx';
import NotificationsPage from './pages/NotificationsPage.tsx';
import InvitePage from './pages/InvitePage.tsx';
import LeaderboardPage from './pages/LeaderboardPage.tsx';
import { Loader } from './components/ui.tsx';

// Пульт судьи — отдельный чанк: игрокам он не нужен.
const RefereeSection = lazy(() => import('./pages/referee/RefereeSection.tsx'));

export default function App() {
  useThemeSync();
  return (
    <Routes>
      {/* Логин — вне общего каркаса. */}
      <Route path="/login" element={<LoginPage />} />

      {/* Все остальные страницы — внутри Layout (нижняя навигация/сайдбар). */}
      <Route element={<Layout />}>
        {/* Публичные (доступны гостю). */}
        <Route path="/" element={<FeedPage />} />
        <Route path="/tournaments/:id" element={<TournamentPage />} />
        <Route path="/tournaments/:id/bracket" element={<BracketPage />} />
        <Route path="/invite/:code" element={<InvitePage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />

        {/* Приватные (гость → /login). */}
        <Route
          path="/matches"
          element={
            <RequireAuth>
              <MyMatchesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/my/tournaments"
          element={
            <RequireAuth>
              <MyTournamentsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/notifications"
          element={
            <RequireAuth>
              <NotificationsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/profile"
          element={
            <RequireAuth>
              <ProfilePage />
            </RequireAuth>
          }
        />

        <Route
          path="/referee/*"
          element={
            <RequireAuth>
              <Suspense fallback={<Loader />}>
                <RefereeSection />
              </Suspense>
            </RequireAuth>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
