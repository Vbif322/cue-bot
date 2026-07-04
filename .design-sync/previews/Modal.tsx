import { Modal, Input, Button } from '@cue-bot/ui';

// The full "add participant" dialog — Modal composed with Input + Button,
// as used in the admin. Modal renders its own dimmed full-screen overlay
// (fixed inset-0); the transform on the wrapper makes it the containing block
// for that fixed overlay so the dimmed backdrop + centered panel render whole
// inside the card. In the real app the Modal is simply mounted at the app root.
export function AddParticipant() {
  return (
    <div style={{ position: 'relative', width: '100%', height: 420, transform: 'translateZ(0)' }}>
      <Modal title="Добавить участника" onClose={() => {}}>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: '#4b5563' }}>
            Имя участника *
          </label>
          <Input type="text" placeholder="Иван Петров" />
          <label style={{ fontSize: 12, fontWeight: 500, color: '#4b5563' }}>
            Username (необязательно)
          </label>
          <Input type="text" placeholder="@username" />
          <Button variant="primary" style={{ width: '100%' }}>
            Добавить участника
          </Button>
        </div>
      </Modal>
    </div>
  );
}
