import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useMe, useLogout } from "../lib/useAuth.ts";

const navItems = [
  { to: "/tournaments", label: "Турниры" },
  { to: "/users", label: "Пользователи" },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { data } = useMe();
  const { mutate: logout } = useLogout();

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="font-semibold text-gray-900">Cue Bot</h1>
          <p className="text-xs text-gray-500 mt-0.5">Панель управления</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-700 hover:bg-gray-100"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-200">
          <p className="text-xs text-gray-500 mb-2">@{data?.user?.username}</p>
          <button
            onClick={() => logout()}
            className="w-full text-left px-3 py-2 text-sm text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
          >
            Выйти
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
