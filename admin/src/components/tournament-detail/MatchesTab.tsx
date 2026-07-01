import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { matchesApi } from '../../lib/api.ts';
import type { ApiMatch } from '../../lib/api.ts';
import { MatchStatusBadge, Chevron } from '@cue-bot/ui';
import { formatUtc } from '../../lib/datetime.ts';
import { groupLetter } from '../../lib/tournamentLabels.ts';

function playoffRoundName(round: number, maxRound: number): string {
  switch (maxRound - round) {
    case 0:
      return 'Финал';
    case 1:
      return 'Полуфинал';
    case 2:
      return 'Четвертьфинал';
    case 3:
      return '1/8 финала';
    case 4:
      return '1/16 финала';
    default:
      return `Раунд ${round}`;
  }
}

interface Round {
  key: string; // уникален глобально: `${section.key}:r${round}`
  label: string;
  matches: ApiMatch[];
  allCompleted: boolean;
}

interface Section {
  key: string;
  title: string | null;
  rounds: Round[];
}

const byRoundThenPosition = (a: ApiMatch, b: ApiMatch): number =>
  a.round - b.round || a.position - b.position;

/**
 * Group already-sorted matches into rounds by `round`, preserving order. Each
 * round gets a globally-unique key (prefixed with the section key) and a flag
 * for whether every match in it is completed.
 */
function buildRounds(
  sectionKey: string,
  matches: ApiMatch[],
  label: (round: number) => string,
): Round[] {
  const byRound = new Map<number, ApiMatch[]>();
  for (const m of matches) {
    const bucket = byRound.get(m.round);
    if (bucket) bucket.push(m);
    else byRound.set(m.round, [m]);
  }
  return [...byRound.entries()].map(([round, rows]) => ({
    key: `${sectionKey}:r${round}`,
    label: label(round),
    matches: rows,
    allCompleted: rows.every((m) => m.status === 'completed'),
  }));
}

/**
 * Split matches into ordered sections, each grouped into collapsible rounds. For
 * the groups_playoff format the group stage (one section per group) is shown
 * first, then the playoff — so qualifiers playing the bracket aren't mixed into
 * the group rounds they share numbers with. Every other format keeps a single
 * flat "R{round}" section.
 */
function buildSections(matches: ApiMatch[]): Section[] {
  const isGroups = matches.some((m) => m.phase === 'group');
  if (!isGroups) {
    const rows = [...matches].sort(byRoundThenPosition);
    return [
      {
        key: 'all',
        title: null,
        rounds: buildRounds('all', rows, (round) => `R${round}`),
      },
    ];
  }

  const sections: Section[] = [];

  const groupMatches = matches.filter((m) => m.phase === 'group');
  const groupIndexes = [
    ...new Set(groupMatches.map((m) => m.groupIndex ?? 0)),
  ].sort((a, b) => a - b);
  for (const gi of groupIndexes) {
    const rows = groupMatches
      .filter((m) => (m.groupIndex ?? 0) === gi)
      .sort(byRoundThenPosition);
    const key = `group-${gi}`;
    sections.push({
      key,
      title: `Групповой этап · Группа ${groupLetter(gi)}`,
      rounds: buildRounds(key, rows, (round) => `Тур ${round}`),
    });
  }

  const playoff = matches
    .filter((m) => m.phase === 'playoff')
    .sort(byRoundThenPosition);
  if (playoff.length > 0) {
    const maxRound = Math.max(...playoff.map((m) => m.round));
    sections.push({
      key: 'playoff',
      title: 'Плей-офф (олимпийка)',
      rounds: buildRounds('playoff', playoff, (round) =>
        playoffRoundName(round, maxRound),
      ),
    });
  }

  return sections;
}

export default function MatchesTab({ tournamentId }: { tournamentId: string }) {
  const { data: matches } = useQuery({
    queryKey: ['tournament-matches', tournamentId],
    queryFn: () => matchesApi.byTournament(tournamentId),
  });

  const sections = useMemo(
    () => (matches ? buildSections(matches) : []),
    [matches],
  );
  const isEmpty = !matches?.length;

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const seededFor = useRef<string | null>(null);

  // Seed defaults once per tournament: completed rounds start collapsed. Guarded
  // by a ref so React Query refetches (e.g. on window focus) don't clobber the
  // user's manual toggles.
  useEffect(() => {
    if (!matches || seededFor.current === tournamentId) return;
    seededFor.current = tournamentId;
    const init = new Set<string>();
    for (const section of sections) {
      for (const round of section.rounds) {
        if (round.allCompleted) init.add(round.key);
      }
    }
    setCollapsed(init);
  }, [matches, tournamentId, sections]);

  const toggle = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <>
      {/* Mobile match cards */}
      <div className="md:hidden space-y-3">
        {isEmpty && (
          <div className="text-center text-gray-400 py-8 text-sm">
            Матчи не созданы
          </div>
        )}
        {sections.map((section) => {
          const sectionCollapsed = collapsed.has(section.key);
          return (
            <div key={section.key} className="space-y-3">
              {section.title && (
                <button
                  type="button"
                  onClick={() => toggle(section.key)}
                  className="flex w-full items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 pt-2"
                >
                  <Chevron collapsed={sectionCollapsed} />
                  <span>{section.title}</span>
                </button>
              )}
              {!sectionCollapsed &&
                section.rounds.map((round) => {
                  const roundCollapsed = collapsed.has(round.key);
                  return (
                    <div key={round.key} className="space-y-3">
                      <button
                        type="button"
                        onClick={() => toggle(round.key)}
                        className="flex w-full items-center gap-1.5 text-xs font-medium text-gray-500"
                      >
                        <Chevron collapsed={roundCollapsed} />
                        <span>
                          {round.label}
                          {round.matches.some(
                            (m) => m.bracketType === 'losers',
                          ) && <span className="text-orange-500 ml-1">L</span>}
                        </span>
                        <span className="text-gray-400">
                          ({round.matches.length})
                        </span>
                      </button>
                      {!roundCollapsed &&
                        round.matches.map((m) => (
                          <div
                            key={m.id}
                            className="bg-white rounded-xl border border-gray-200 p-4"
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                {m.tableName && (
                                  <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                                    {m.tableName}
                                  </span>
                                )}
                                {m.scheduledAt && (
                                  <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                                    🗓 {formatUtc(m.scheduledAt)}
                                  </span>
                                )}
                              </div>
                              <MatchStatusBadge status={m.status} />
                            </div>
                            <div className="flex items-center justify-center gap-3 my-3">
                              <span className="font-medium text-gray-900 text-sm text-right flex-1">
                                {m.player1Name ?? m.player1Username ?? 'TBD'}
                              </span>
                              <span className="font-mono text-gray-700 text-sm px-2">
                                {m.player1Score !== null &&
                                m.player2Score !== null
                                  ? `${m.player1Score}:${m.player2Score}`
                                  : 'vs'}
                              </span>
                              <span className="font-medium text-gray-900 text-sm text-left flex-1">
                                {m.player2Name ?? m.player2Username ?? 'TBD'}
                              </span>
                            </div>
                            <div className="text-right">
                              <Link
                                to={`/matches/${m.id}`}
                                className="text-blue-500 text-xs"
                              >
                                Управление
                              </Link>
                            </div>
                          </div>
                        ))}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>

      {/* Desktop matches table */}
      <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                Раунд
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                Игрок 1
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                Счёт
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                Игрок 2
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                Стол
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                Дата
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                Статус
              </th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sections.map((section) => {
              const sectionCollapsed = collapsed.has(section.key);
              return (
                <Fragment key={section.key}>
                  {section.title && (
                    <tr
                      className="bg-gray-50/70 cursor-pointer hover:bg-gray-100/70"
                      onClick={() => toggle(section.key)}
                    >
                      <td
                        colSpan={8}
                        className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500"
                      >
                        <span className="flex items-center gap-1.5">
                          <Chevron collapsed={sectionCollapsed} />
                          {section.title}
                        </span>
                      </td>
                    </tr>
                  )}
                  {!sectionCollapsed &&
                    section.rounds.map((round) => {
                      const roundCollapsed = collapsed.has(round.key);
                      const hasLosers = round.matches.some(
                        (m) => m.bracketType === 'losers',
                      );
                      return (
                        <Fragment key={round.key}>
                          <tr
                            className="bg-gray-50/40 cursor-pointer hover:bg-gray-100/50"
                            onClick={() => toggle(round.key)}
                          >
                            <td
                              colSpan={8}
                              className="px-4 py-2 text-xs font-medium text-gray-500"
                            >
                              <span className="flex items-center gap-1.5">
                                <Chevron collapsed={roundCollapsed} />
                                {round.label}
                                {hasLosers && (
                                  <span className="text-orange-500">L</span>
                                )}
                                <span className="text-gray-400">
                                  ({round.matches.length})
                                </span>
                              </span>
                            </td>
                          </tr>
                          {!roundCollapsed &&
                            round.matches.map((m) => (
                              <tr key={m.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                                  {round.label}
                                  {m.bracketType === 'losers' && (
                                    <span className="ml-1 text-xs text-orange-500">
                                      L
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  {m.player1Name ?? m.player1Username ?? 'TBD'}
                                </td>
                                <td className="px-4 py-3 font-mono text-center">
                                  {m.player1Score !== null &&
                                  m.player2Score !== null
                                    ? `${m.player1Score}:${m.player2Score}`
                                    : '—'}
                                </td>
                                <td className="px-4 py-3">
                                  {m.player2Name ?? m.player2Username ?? 'TBD'}
                                </td>
                                <td className="px-4 py-3 text-gray-500 text-xs">
                                  {m.tableName ?? '—'}
                                </td>
                                <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                                  {formatUtc(m.scheduledAt) || '—'}
                                </td>
                                <td className="px-4 py-3">
                                  <MatchStatusBadge status={m.status} />
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <Link
                                    to={`/matches/${m.id}`}
                                    className="text-blue-500 hover:text-blue-700 text-xs"
                                  >
                                    Управление
                                  </Link>
                                </td>
                              </tr>
                            ))}
                        </Fragment>
                      );
                    })}
                </Fragment>
              );
            })}
            {isEmpty && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-gray-400">
                  Матчи не созданы
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
