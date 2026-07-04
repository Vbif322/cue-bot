import { useEffect, useState } from 'react';

/** Реактивный matchMedia-хук (mobile-first брейкпоинты). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** true на десктопе (ширина ≥ 821px). */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 821px)');
}
