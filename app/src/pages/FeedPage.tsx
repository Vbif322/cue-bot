// Лента турниров (макет tournament-list): фильтр по статусу, сетка карточек,
// скелетоны загрузки, пустые состояния. Доступна гостю.
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { federationsApi, tournamentsApi } from '../lib/api.ts';
import type { TournamentStatus } from '../lib/types.ts';
import { useMe } from '../lib/useAuth.ts';
import TournamentCard from '../components/TournamentCard.tsx';
import { Chip } from '../components/controls.tsx';
import { EmptyState, ErrorBox } from '../components/ui.tsx';

type StatusFilter = TournamentStatus | 'all';

const STATUS_CHIPS: [string, StatusFilter][] = [
  ['Все', 'all'],
  ['Регистрация', 'registration_open'],
  ['Идёт', 'in_progress'],
  ['Завершённые', 'completed'],
];

const GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 14,
};

function SkeletonCard() {
  const shimmer: CSSProperties = {
    background:
      'linear-gradient(90deg, rgb(255 255 255 / 0.04) 25%, rgb(255 255 255 / 0.1) 37%, rgb(255 255 255 / 0.04) 63%)',
    backgroundSize: '400% 100%',
    animation: 'cb-shimmer 1.4s ease infinite',
  };
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        background: 'var(--surface-2)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 16,
        padding: 18,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span
          className="cb-shimmer"
          style={{ width: 74, height: 12, borderRadius: 6, ...shimmer }}
        />
        <span
          className="cb-shimmer"
          style={{ width: 88, height: 22, borderRadius: 999, ...shimmer }}
        />
      </div>
      <span
        className="cb-shimmer"
        style={{ width: '78%', height: 18, borderRadius: 7, ...shimmer }}
      />
      <span
        className="cb-shimmer"
        style={{ width: '52%', height: 13, borderRadius: 6, ...shimmer }}
      />
      <span
        className="cb-shimmer"
        style={{
          width: '100%',
          height: 6,
          borderRadius: 999,
          marginTop: 4,
          ...shimmer,
        }}
      />
    </div>
  );
}

export default function FeedPage() {
  const [filter, setFilter] = useState<StatusFilter>('all');
  const { data: me } = useMe();
  const myCity = me?.user?.city ?? null;

  // Город: по умолчанию — город игрока (если задан), иначе все. Явный выбор
  // «Все города» запоминается на время сессии вкладки.
  const [cityMode, setCityMode] = useState<'city' | 'all' | null>(null);
  useEffect(() => {
    if (cityMode === null && me !== undefined)
      setCityMode(myCity ? 'city' : 'all');
  }, [cityMode, me, myCity]);
  const cityApplied = cityMode === 'city' && myCity ? myCity : undefined;

  const [federationId, setFederationId] = useState<string>('');

  const { data: federations = [] } = useQuery({
    queryKey: ['federations', cityApplied ?? 'all'],
    queryFn: () => federationsApi.list(cityApplied),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['tournaments', cityApplied ?? 'all', federationId],
    queryFn: () =>
      tournamentsApi.list({
        ...(cityApplied ? { city: cityApplied } : {}),
        ...(federationId ? { federationId } : {}),
      }),
    enabled: cityMode !== null,
  });

  const all = data ?? [];
  const filtered =
    filter === 'all' ? all : all.filter((t) => t.status === filter);

  const countLabel =
    isLoading || cityMode === null
      ? 'Загрузка…'
      : all.length === 0
        ? 'Нет доступных турниров'
        : `Найдено турниров: ${filtered.length}`;

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', boxSizing: 'border-box' }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 5,
          boxSizing: 'border-box',
          background: 'var(--surface-overlay)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '18px 20px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div
            style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}
          >
            Турниры
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>
            {countLabel}
          </div>
        </div>
        <div
          className="cb-chips"
          style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            paddingBottom: 2,
          }}
        >
          {STATUS_CHIPS.map(([label, value]) => (
            <Chip
              key={value}
              active={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </Chip>
          ))}
        </div>
        {(myCity || federations.length > 0) && (
          <div
            className="cb-chips"
            style={{
              display: 'flex',
              gap: 8,
              overflowX: 'auto',
              paddingBottom: 2,
              alignItems: 'center',
            }}
          >
            {myCity && (
              <>
                <Chip
                  active={cityMode === 'city'}
                  onClick={() => setCityMode('city')}
                >
                  📍 {myCity}
                </Chip>
                <Chip
                  active={cityMode === 'all'}
                  onClick={() => setCityMode('all')}
                >
                  Все города
                </Chip>
              </>
            )}
            {federations.length > 0 && (
              <select
                aria-label="Организатор"
                value={federationId}
                onChange={(e) => setFederationId(e.target.value)}
                style={{
                  marginLeft: myCity ? 6 : 0,
                  padding: '6px 10px',
                  borderRadius: 999,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--surface-2)',
                  color: 'inherit',
                  fontSize: 13,
                }}
              >
                <option value="">Все организаторы</option>
                {federations.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </header>

      <main style={{ padding: '20px', boxSizing: 'border-box' }}>
        {error && <ErrorBox message={error.message} />}

        {isLoading && (
          <div style={GRID}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {!isLoading &&
          cityMode !== null &&
          all.length === 0 &&
          (cityApplied ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                alignItems: 'center',
              }}
            >
              <EmptyState
                title={`В городе ${cityApplied} турниров нет`}
                hint="Посмотрите, что проходит в других городах."
              />
              <Chip active={false} onClick={() => setCityMode('all')}>
                Показать все города
              </Chip>
            </div>
          ) : (
            <EmptyState
              title="Турниров пока нет"
              hint="Скоро здесь появятся новые турниры. Загляните чуть позже."
            />
          ))}

        {!isLoading && all.length > 0 && filtered.length === 0 && (
          <EmptyState
            title="Ничего не найдено"
            hint="Под выбранный фильтр нет турниров. Попробуйте другой статус."
          />
        )}

        {!isLoading && filtered.length > 0 && (
          <div style={GRID}>
            {filtered.map((t) => (
              <TournamentCard key={t.id} tournament={t} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
