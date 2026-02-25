import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usersApi } from "../lib/api.ts";
import { useMe } from "../lib/useAuth.ts";

export default function UsersPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: users, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: usersApi.list,
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: "user" | "admin" }) =>
      usersApi.setRole(id, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Пользователи</h2>
      </div>

      {isLoading ? (
        <div className="text-gray-500 text-sm">Загрузка...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">
                  Пользователь
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">
                  Telegram ID
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">
                  Роль
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users?.map((u) => {
                const isMe = u.id === me?.user?.id;
                return (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">
                        {u.name ?? u.username}
                        {isMe && (
                          <span className="ml-2 text-xs text-gray-400">(вы)</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500">@{u.username}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                      {u.telegramId}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          u.role === "admin"
                            ? "bg-purple-100 text-purple-700"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {u.role === "admin" ? "Администратор" : "Пользователь"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!isMe && (
                        <button
                          onClick={() => {
                            const newRole = u.role === "admin" ? "user" : "admin";
                            const label =
                              newRole === "admin"
                                ? "сделать администратором"
                                : "снять права администратора";
                            if (confirm(`${u.username}: ${label}?`))
                              roleMutation.mutate({ id: u.id, role: newRole });
                          }}
                          disabled={roleMutation.isPending}
                          className={`text-xs ${
                            u.role === "admin"
                              ? "text-red-500 hover:text-red-700"
                              : "text-blue-500 hover:text-blue-700"
                          } disabled:opacity-50`}
                        >
                          {u.role === "admin" ? "Снять права" : "Сделать адм."}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
