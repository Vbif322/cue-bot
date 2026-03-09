import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tablesApi } from "../lib/api.ts";

export default function TablesPage() {
  const qc = useQueryClient();
  const { data: tables = [], isLoading } = useQuery({
    queryKey: ["tables"],
    queryFn: () => tablesApi.list(),
  });

  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");

  const create = useMutation({
    mutationFn: () => tablesApi.create(newName.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tables"] });
      setNewName("");
      setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => tablesApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tables"] }),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Столы</h1>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>
      )}

      {/* Create form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) create.mutate();
        }}
        className="flex gap-2 mb-6"
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Название стола..."
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={!newName.trim() || create.isPending}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          Добавить
        </button>
      </form>

      {/* Tables list */}
      {isLoading ? (
        <div className="text-gray-500 text-sm">Загрузка...</div>
      ) : tables.length === 0 ? (
        <div className="text-gray-500 text-sm">Столов пока нет</div>
      ) : (
        <div className="space-y-2">
          {tables.map((table) => (
            <div
              key={table.id}
              className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-3"
            >
              <span className="text-sm font-medium text-gray-900">{table.name}</span>
              <button
                onClick={() => remove.mutate(table.id)}
                disabled={remove.isPending}
                className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
              >
                Удалить
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
