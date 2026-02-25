import { Routes, Route, Navigate } from "react-router-dom";
import { useMe } from "./lib/useAuth.ts";
import Layout from "./components/Layout.tsx";
import LoginPage from "./pages/LoginPage.tsx";
import DashboardPage from "./pages/DashboardPage.tsx";
import TournamentsPage from "./pages/TournamentsPage.tsx";
import TournamentDetailPage from "./pages/TournamentDetailPage.tsx";
import MatchDetailPage from "./pages/MatchDetailPage.tsx";
import UsersPage from "./pages/UsersPage.tsx";

export default function App() {
  const { data, isLoading } = useMe();
  const isAuthenticated = !!data?.user;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Загрузка...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/tournaments" replace />} />
        <Route path="/tournaments" element={<TournamentsPage />} />
        <Route path="/tournaments/:id" element={<TournamentDetailPage />} />
        <Route path="/matches/:id" element={<MatchDetailPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="*" element={<Navigate to="/tournaments" replace />} />
      </Routes>
    </Layout>
  );
}
