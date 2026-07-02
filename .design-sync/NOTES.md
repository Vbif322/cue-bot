# design-sync notes — @cue-bot/ui

Repo-specific gotchas for future syncs. Read this before re-running.

## Build shape

- `@cue-bot/ui` (`packages/ui`) is a **source-only workspace package** — no `dist/`, no build
  script, `exports["."] → ./src/index.ts`, and `tsconfig` uses `noEmit` + `.tsx` import
  specifiers. So there is **no `.d.ts` tree** for the converter to read.
- Consequences, both handled in `config.json`:
  - Components are **pinned** via `componentSrcMap` (all 10 → their `src/*.tsx`). Without pins
    the converter reports `[ZERO_MATCH]` (it only auto-discovers from `.d.ts` exports).
  - Props are **hand-written** in `dtsPropsFor` (one interface body per component), since prop
    extraction reads `.d.ts` only. Keep these in sync if a component's props change. The
    native-attr components (Button/Input/Select) list their key props explicitly + a
    "forwards native attrs" note — they do not literally `extends` the DOM attr types.
- Bundle entry is `./packages/ui/src/index.ts` (esbuild bundles the TS/TSX directly; react is
  externalized to `window.React`). `--node-modules ./node_modules` (repo root; the workspace
  symlink `node_modules/@cue-bot/ui → packages/ui` resolves, and react lives at the root).

## CSS pipeline (important — recompile step)

- The components are styled with **Tailwind v4 utility classes** (`bg-primary`, `px-2.5`,
  `bg-tone-success-bg`, `bg-black/40`, …). `theme.css` alone only DEFINES the `@theme` tokens;
  it does not emit those utilities. So a compiled stylesheet must be produced before the
  converter runs and pointed at via `cfg.cssEntry`.
- `cfg.buildCmd` runs the Tailwind v4 CLI over `.design-sync/tailwind-entry.css`
  (`@import 'tailwindcss'` + theme.css + `@source '../packages/ui/src'`) → `packages/ui/.ds-compiled.css`
  (gitignored). **Re-run `cfg.buildCmd` before the converter whenever component classes change.**
- `cfg.cssEntry` is bounded to the package dir, hence the compiled file lives under `packages/ui/`.

## Verification

- No Playwright browser was downloaded. The render check + capture drove the **system Google
  Chrome** via `DS_CHROMIUM_PATH=/usr/bin/google-chrome` (playwright JS lib installed into
  `.ds-sync/` with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`). Prefix validate/capture with that env
  var on re-sync, or install a real browser.
- All 10 components have authored previews in `.design-sync/previews/`, all cells graded `good`.
  No `[RENDER_THIN]`/`[RENDER_BLANK]`/`variantsIdentical` warns at the end.

## Preview authoring conventions used here

- Layout glue in previews uses **inline styles**, never arbitrary Tailwind classes — the
  compiled CSS only contains classes found in `packages/ui/src`, so e.g. `space-y-3` would not
  resolve. Component-internal classes render fine.
- **Modal** (`fixed inset-0` overlay) is wrapped in a `transform: translateZ(0)` container with
  an explicit height so the fixed overlay establishes its containing block inside the card and
  the dimmed backdrop + centered panel render whole. Card override:
  `overrides.Modal = { cardMode: "single", viewport: "480x480" }`.

## Grouping

- All 10 components land under a single `general` group (they are flat in `src/` with no docs
  tree, and there is no per-component group override). Cosmetic. To split into
  Badges/Forms/Overlay later, add `docsMap` stubs with `category:` frontmatter (each stub then
  becomes that component's `.prompt.md` body — re-include the JSDoc description).

## Re-sync risks (what can silently go stale)

- **`dtsPropsFor` is hand-written** and NOT derived from source — if a component's real props
  change, the shipped `.d.ts`/prompt will be wrong until the config entry is updated. There is
  no build-time check that they match `src`.
- **`.ds-compiled.css` is a generated, gitignored artifact.** A fresh clone / re-sync must run
  `cfg.buildCmd` first (it is not auto-run by the driver). If skipped, previews render unstyled.
- **`conventions.md` claims** (token names, prop APIs) were validated against the built bundle
  on this run; re-validate on major changes.
- Verification depends on a system Chrome being present at `/usr/bin/google-chrome`.
