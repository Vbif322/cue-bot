import { useQuery } from "@tanstack/react-query";
import { tournamentsApi } from "../lib/api.ts";

export default function DashboardPage() {
  const { data: tournaments } = useQuery({
    queryKey: ["tournaments"],
    queryFn: tournamentsApi.list,
  });

  const active = tournaments?.filter((t) => t.status === "in_progress") ?? [];
  const regOpen = tournaments?.filter((t) => t.status === "registration_open") ?? [];
  const draft = tournaments?.filter((t) => t.status === "draft") ?? [];

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-900 mb-6">Обзор</h2>
      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard label="Активных турниров" value={active.length} color="blue" />
        <StatCard label="Регистрация открыта" value={regOpen.length} color="green" />
        <StatCard label="Черновиков" value={draft.length} color="gray" />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "blue" | "green" | "gray";
}) {
  const colors = {
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    green: "bg-green-50 text-green-700 border-green-200",
    gray: "bg-gray-50 text-gray-700 border-gray-200",
  };

  return (
    <div className={`rounded-xl border p-5 ${colors[color]}`}>
      <p className="text-3xl font-bold">{value}</p>
      <p className="text-sm mt-1 opacity-80">{label}</p>
    </div>
  );
}
