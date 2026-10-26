// Переход «сайт игрока → панель управления» для админов и организаторов (isStaff).
// Сессии раздельные, поэтому кнопка запрашивает одноразовую ссылку входа и уходит
// по ней (редим ставит admin-сессию на хосте админки). Остальным ничего не рендерит.
import { useMutation } from '@tanstack/react-query';
import { useMe } from '../lib/useAuth.ts';
import { appAuth } from '../lib/api.ts';
import { Btn } from './controls.tsx';

export default function AdminSwitch({ block = false }: { block?: boolean }) {
  const { data: me } = useMe();
  const mut = useMutation({
    mutationFn: () => appAuth.adminLink(),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });

  if (me?.user?.isStaff !== true) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Btn
        variant="ghost"
        size="sm"
        block={block}
        disabled={mut.isPending || mut.isSuccess}
        onClick={() => mut.mutate()}
      >
        Панель управления
      </Btn>
      {mut.error && (
        <span style={{ fontSize: 11, color: 'var(--color-red-500, #ef4444)' }}>
          {mut.error.message}
        </span>
      )}
    </div>
  );
}
