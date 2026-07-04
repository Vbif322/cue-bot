// Турнирная сетка на выбывание (макет tournament-bracket): колонки раундов,
// SVG-коннекторы, подсветка пути игрока, горизонтальный скролл, клик → модалка.
import type { AppBracket, AppMatch, BracketPlayer } from '../lib/types.ts';
import { displayName, roundLabel } from '../lib/format.ts';
import { MatchStatusBadge } from '@cue-bot/ui';

const CARD_W = 224;
const CARD_H = 88;
const COL_GAP = 68;
const SLOT = 104;
const PADX = 28;
const PADY = 24;

interface Positioned {
  match: AppMatch;
  x: number;
  y: number;
  center: number;
  onPath: boolean;
}

interface Connector {
  points: string;
  highlight: boolean;
}

function sideName(match: AppMatch, slot: 1 | 2, players: Record<string, BracketPlayer>): string {
  const walkover = slot === 1 ? match.player1IsWalkover : match.player2IsWalkover;
  const id = slot === 1 ? match.player1Id : match.player2Id;
  if (walkover) return 'Проходит';
  if (!id) return 'Ожидается';
  const p = players[id];
  return p ? displayName(p) : 'Игрок';
}

/** Множество id матчей на пути игрока (его матчи + их продолжение по nextMatchId). */
function computePath(matches: AppMatch[], myId: string | null): Set<string> {
  const path = new Set<string>();
  if (!myId) return path;
  const byId = new Map(matches.map((m) => [m.id, m]));
  for (const m of matches) {
    if (m.player1Id !== myId && m.player2Id !== myId) continue;
    let cur: AppMatch | undefined = m;
    while (cur && !path.has(cur.id)) {
      path.add(cur.id);
      cur = cur.nextMatchId ? byId.get(cur.nextMatchId) : undefined;
    }
  }
  return path;
}

function layoutSection(
  matches: AppMatch[],
  path: Set<string>,
): { cards: Positioned[]; connectors: Connector[]; width: number; height: number; rounds: number[] } {
  const byRound = new Map<number, AppMatch[]>();
  for (const m of matches) {
    const arr = byRound.get(m.round) ?? [];
    arr.push(m);
    byRound.set(m.round, arr);
  }
  const rounds = [...byRound.keys()].sort((a, b) => a - b);
  for (const r of rounds) byRound.get(r)!.sort((a, b) => a.position - b.position);

  const centers = new Map<string, number>();
  const cards: Positioned[] = [];
  const xOf = (ri: number) => PADX + ri * (CARD_W + COL_GAP);

  rounds.forEach((r, ri) => {
    const col = byRound.get(r)!;
    col.forEach((m, i) => {
      const feeders = matches.filter((x) => x.nextMatchId === m.id && centers.has(x.id));
      const center =
        feeders.length > 0
          ? feeders.reduce((sum, f) => sum + centers.get(f.id)!, 0) / feeders.length
          : PADY + i * SLOT + CARD_H / 2;
      centers.set(m.id, center);
      cards.push({ match: m, x: xOf(ri), y: center - CARD_H / 2, center, onPath: path.has(m.id) });
    });
  });

  const connectors: Connector[] = [];
  rounds.forEach((r, ri) => {
    if (ri === 0) return;
    for (const m of byRound.get(r)!) {
      const feeders = matches.filter((x) => x.nextMatchId === m.id && centers.has(x.id));
      const xLeft = xOf(ri);
      for (const f of feeders) {
        const xFeederRight = xOf(ri - 1) + CARD_W;
        const midX = xFeederRight + COL_GAP / 2;
        const yF = centers.get(f.id)!;
        const yM = centers.get(m.id)!;
        connectors.push({
          points: `${xFeederRight},${yF} ${midX},${yF} ${midX},${yM} ${xLeft},${yM}`,
          highlight: path.has(f.id) && path.has(m.id),
        });
      }
    }
  });

  const maxCenter = cards.length ? Math.max(...cards.map((c) => c.center)) : PADY;
  const width = PADX * 2 + rounds.length * CARD_W + Math.max(0, rounds.length - 1) * COL_GAP;
  const height = maxCenter + CARD_H / 2 + PADY;
  return { cards, connectors, width, height, rounds };
}

function BracketCard({
  card,
  players,
  totalRounds,
  onSelect,
}: {
  card: Positioned;
  players: Record<string, BracketPlayer>;
  totalRounds: number;
  onSelect: (id: string) => void;
}) {
  const m = card.match;
  const scheduled = m.status === 'scheduled';
  const s1 = m.player1Score;
  const s2 = m.player2Score;
  const lead1 = !scheduled && s1 != null && s2 != null && s1 > s2;
  const lead2 = !scheduled && s1 != null && s2 != null && s2 > s1;

  const row = (name: string, score: number | null, lead: boolean) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span
        style={{
          fontSize: 13,
          fontWeight: lead ? 700 : 500,
          color: lead ? '#f3f4f6' : '#9aa0aa',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {name}
      </span>
      <span
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: lead ? '#f3f4f6' : '#6b7280',
          fontVariantNumeric: 'tabular-nums',
          flex: 'none',
        }}
      >
        {scheduled ? '—' : (score ?? '—')}
      </span>
    </div>
  );

  return (
    <button
      type="button"
      onClick={() => onSelect(m.id)}
      style={{
        position: 'absolute',
        left: card.x,
        top: card.y,
        width: CARD_W,
        height: CARD_H,
        boxSizing: 'border-box',
        textAlign: 'left',
        background: '#17181e',
        border: card.onPath
          ? '1px solid rgba(59,130,246,0.6)'
          : '1px solid rgba(255,255,255,0.08)',
        boxShadow: card.onPath ? '0 0 0 1px rgba(59,130,246,0.18)' : 'none',
        borderRadius: 12,
        cursor: 'pointer',
        padding: '9px 11px',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        fontFamily: 'inherit',
        color: 'inherit',
      }}
    >
      {row(sideName(m, 1, players), s1, lead1)}
      {row(sideName(m, 2, players), s2, lead2)}
      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', marginTop: 'auto' }} />
      <div style={{ display: 'flex' }}>
        <MatchStatusBadge status={m.status} />
      </div>
    </button>
  );
}

const SECTION_TITLES: Record<string, string> = {
  winners: 'Основная сетка',
  losers: 'Нижняя сетка',
  grand_final: 'Гранд-финал',
};

export default function Bracket({
  bracket,
  myId,
  onSelectMatch,
}: {
  bracket: AppBracket;
  myId: string | null;
  onSelectMatch: (id: string) => void;
}) {
  const playoff = bracket.matches.filter((m) => m.phase !== 'group');
  const path = computePath(playoff, myId);

  // Группируем по типу сетки: winners (или null) — основное дерево, losers/GF — отдельно.
  const groups = new Map<string, AppMatch[]>();
  for (const m of playoff) {
    const key = m.bracketType ?? 'winners';
    const arr = groups.get(key) ?? [];
    arr.push(m);
    groups.set(key, arr);
  }
  const order = ['winners', 'losers', 'grand_final'].filter((k) => groups.has(k));
  const multi = order.length > 1;

  return (
    <div className="cb-scroll" style={{ overflow: 'auto', height: '100%', padding: '0 0 20px' }}>
      {order.map((key) => {
        const { cards, connectors, width, height, rounds } = layoutSection(groups.get(key)!, path);
        return (
          <div key={key} style={{ position: 'relative', minWidth: width }}>
            {multi && (
              <div
                style={{
                  padding: '14px 20px 6px',
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: '#6b7280',
                }}
              >
                {SECTION_TITLES[key] ?? key}
              </div>
            )}

            {/* Заголовки раундов */}
            <div style={{ position: 'relative', height: 40, width }}>
              {rounds.map((r, ri) => (
                <div
                  key={r}
                  style={{
                    position: 'absolute',
                    left: PADX + ri * (CARD_W + COL_GAP),
                    width: CARD_W,
                    top: 8,
                    textAlign: 'center',
                    fontSize: 13,
                    fontWeight: 700,
                    color: '#e5e7eb',
                  }}
                >
                  {key === 'grand_final'
                    ? 'Финал'
                    : key === 'losers'
                      ? `Раунд ${r}`
                      : roundLabel(r, bracket.totalRounds)}
                </div>
              ))}
            </div>

            {/* Полотно сетки */}
            <div style={{ position: 'relative', width, height }}>
              <svg
                width={width}
                height={height}
                style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', overflow: 'visible' }}
              >
                {connectors.map((c, i) => (
                  <polyline
                    key={i}
                    points={c.points}
                    fill="none"
                    stroke={c.highlight ? 'var(--color-primary)' : 'rgba(255,255,255,0.12)'}
                    strokeWidth={c.highlight ? 2.5 : 1.5}
                    strokeLinejoin="round"
                  />
                ))}
              </svg>
              {cards.map((card) => (
                <BracketCard
                  key={card.match.id}
                  card={card}
                  players={bracket.players}
                  totalRounds={bracket.totalRounds}
                  onSelect={onSelectMatch}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
