# @cue-bot/ui — build conventions

`@cue-bot/ui` is a small **React 19** component library styled with **Tailwind v4 semantic
tokens**. Every component is **pure** — there is **no theme/context provider to wrap**. Import
components from `window.CueBotUI`; the design system stylesheet (`styles.css`, which
`@import`s `_ds_bundle.css`) is already applied.

## Styling idiom — the design language lives in props, not in classes you write

Style through each component's small prop API, not by hand-writing class names:

- `Button` — `variant="primary" | "secondary" | "destructive"`, `size="sm" | "md"`; forwards all native `<button>` attrs.
- `Badge` — `tone="neutral" | "muted" | "success" | "warning" | "info" | "accent" | "danger"`.
- `TournamentStatusBadge` / `MatchStatusBadge` / `ParticipantStatusBadge` — pass a `status` string; the component picks the localized label + tone.
- `Input`, `Select` — forward all native attrs (`value`, `onChange`, `placeholder`, `disabled`, …); `Select` takes `<option>` children.
- `Modal` — `title`, `onClose`, `children`, optional `maxWidthClassName`; renders its own dimmed full-screen overlay.
- `InfoRow` — `label` (string) + `value` (node); `Chevron` — `collapsed` boolean.

**For your own layout glue, use inline `style={{…}}`** (flex, gap, padding, widths) — do NOT
reach for arbitrary Tailwind classes. The shipped stylesheet is **not** a full Tailwind build;
it contains only the utilities these components use, plus the token variables. A class like
`grid`, `mt-8`, or `space-y-4` will likely not exist, but the brand palette is available as CSS
variables you can use from inline styles:

- `var(--color-primary)`, `var(--color-primary-hover)`
- tone pairs `var(--color-tone-<name>-bg)` / `var(--color-tone-<name>-fg)` for `<name>` in
  `neutral | muted | success | warning | info | accent | danger`

All user-facing copy in this product is **Russian** — match it.

## Where the truth lives

- `styles.css` (+ its `@import "./_ds_bundle.css"`) — compiled tokens and component styles.
- Per component: `<Name>.prompt.md` (usage) and `<Name>.d.ts` (`<Name>Props`).

## Idiomatic build snippet

```tsx
const { Modal, Input, Button } = window.CueBotUI;

function AddPlayerDialog({ onClose }) {
  return (
    <Modal title="Добавить участника" onClose={onClose}>
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ fontSize: 12, fontWeight: 500, color: '#4b5563' }}>Имя участника *</label>
        <Input type="text" placeholder="Иван Петров" />
        <Button variant="primary" style={{ width: '100%' }}>Добавить</Button>
      </div>
    </Modal>
  );
}
```
