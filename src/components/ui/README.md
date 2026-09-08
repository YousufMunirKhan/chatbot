# UI foundation (Module 22)

One place to look before adding a component or picking a colour. Everything here
describes what the product **already does** — the numbers were counted out of
`src/`, not invented — with the defects called out where the convention and the
code disagree.

Tokens live in `src/app/globals.css`; the Tailwind names that expose them live in
`tailwind.config.ts`.

---

## Type scale

Two sizes carry almost the whole product. Reach outside them only for a reason.

| Class      | Usages | Role                                                          |
| ---------- | -----: | ------------------------------------------------------------- |
| `text-sm`  |    640 | **Body default.** Paragraphs, table cells, form controls, buttons. |
| `text-xs`  |    365 | Metadata: hints, table headers, timestamps, badge text, stat labels. |
| `text-2xl` |     98 | Page `<h1>` (`PageHeader`) and `StatTile` values.              |
| `text-base`|     35 | Card titles in dense grids — `<CardTitle className="text-base">`. |
| `text-lg`  |     21 | Sub-section headings inside a long card.                       |
| `text-3xl` |     12 | The one hero metric on a page, when a tile needs to dominate.  |

`text-xl` and `text-4xl` appear ten times between them, all on marketing pages.
Do not add them to the dashboard.

Weights: `font-medium` for labels and buttons, `font-semibold` for headings and
metric values. There is no `font-bold` in the dashboard.

## Spacing rhythm

A 4px grid, used at three altitudes:

- **`space-y-6`** — between top-level sections of a page (header, then each card).
- **`space-y-4`** — between fields in a form, or rows in a card.
- **`space-y-3`** / **`space-y-2`** — inside a single unit: a stat and its hint,
  a label and its control.
- **`space-y-1.5`** — label → control → hint. This is `FormField`'s internal
  rhythm and both hand-rolled `Field`s already used it; keep it.

Padding: `p-6` for a standard `CardHeader`/`CardContent`, `p-4` for compact tiles
and inset panels, `px-3 py-2` for controls and table cells.

## Elevation

The product is **border-first, not shadow-first** — 17 `shadow-sm` against 64
bordered `rounded-lg` cards. Three levels:

0. **Flat** — the default. `border` + `bg-card`. Every `Card`.
1. **Raised** — `shadow-sm`. Only for something lifted off a busy surface: a
   selected option, a hovered clickable tile.
2. **Floating** — `shadow-lg` and up. Reserved for genuine overlays (popovers,
   dialogs, the widget bubble). `shadow-2xl` exists only on marketing pages.

If you are reaching for a shadow to separate two blocks, use a border or a gap.

## Control size scale

Two heights, defined once in `control-styles.ts` and shared by every control.
Before Module 24 there were four heights across three files and a filter bar
could not be made to line up.

| Size      | Height | `Button` | `Input` | `Select` | Use                          |
| --------- | -----: | :------: | :-----: | :------: | ---------------------------- |
| `default` |   40px |   yes    |   yes   |   yes    | Forms                        |
| `sm`      |   36px |   yes    |   yes   |   yes    | Toolbars, filter bars        |
| `lg`      |   44px |   yes    |    —    |    —     | Page-level call to action    |

Square icon buttons follow the same rhythm — `icon` 40px, `icon-sm` 36px,
`icon-xs` 32px — and all three clear the 24px WCAG 2.5.8 target minimum. **An
icon-only button has no accessible name: always pass `aria-label`.**

`Textarea` has no size variant on purpose. The scale exists to line a control up
with the button beside it in a row, and a multi-line box is never in that row.

## Layout: the breakpoints lie

**`sm:` `md:` `lg:` `xl:` measure the VIEWPORT.** They report the width of the
window and say nothing about the box your component is in. A form laid out
`lg:grid-cols-4` inside a 500px column gave each field 110px on a full-width
screen and a `<select>` clipped its own text mid-word.

About a third of this dashboard is two-column, so about a third of it has a
narrow column that every `lg:` inside it will lie about.

- **A grid of fields → `FieldGrid`.** It is
  `repeat(auto-fit, minmax(min(100%, 16rem), 1fr))`, which asks the container.
- **Two halves that should stack when cramped → `flex flex-wrap` with a
  `basis-*` on each half.** Flexbox wraps against the parent, not the window.
- **A page-level shell question → `md:` is right.** Whether the sidebar is on
  screen genuinely is a viewport question.

`xs:` (400px) exists for the gap between one phone column and 640px. It is still
a viewport breakpoint and still lies about containers.

## Radius

`--radius: 0.5rem` anchors the scale, and Tailwind derives `md` (`-2px`) and
`sm` (`-4px`) from it.

- **`rounded-md`** (256 uses) — controls. Inputs, selects, buttons, inline notes.
- **`rounded-lg`** (64 uses) — containers. Cards, panels, modals.
- **`rounded-full`** (55 uses) — pills and tracks. Badges, avatars, `Progress`.

`rounded-xl`/`2xl`/`3xl` are marketing-page only. A container is never more
rounded than `lg` in the dashboard.

## Semantic colour

Four states, each a **triplet** plus a solid:

| Token                | Use                                                       |
| -------------------- | --------------------------------------------------------- |
| `--success`          | Solid mark: progress fill, status dot, chart series.        |
| `--success-bg`       | Tinted surface behind a badge or alert.                     |
| `--success-border`   | The rule around that surface.                               |
| `--success-fg`       | Text and icons **on `-bg`**, contrast-checked against it.   |

…and the same shape for `warning`, `danger`, `info`. In Tailwind:
`bg-success-bg border-success-border text-success-fg`, or bare `bg-success` for
the solid.

### Rules

1. **Never hardcode a palette colour for state.** `bg-emerald-100`,
   `text-green-600`, `bg-blue-50` do not exist in dark mode — that was the
   `Badge` bug. Use the triplet.
2. **`-fg` is tuned to its own `-bg`, not to the page.** Putting `text-success-fg`
   on a white card still passes, but putting a raw palette green on
   `bg-success-bg` is unverified.
3. **`--info` is cyan, deliberately not the brand blue.** Today `bg-blue-50`
   means "selected" in `quick-action-form.tsx` and "informational" in
   `help-desk/page.tsx`. Keeping info off the 214 hue lets selection keep the
   brand blue and informational keep cyan, so the two stop colliding.
4. **`--border` and `--input` are different jobs.** `--border` is decorative
   (card rules, dividers) and stays light. `--input` is the *only* thing telling
   a user a text control exists, so WCAG 1.4.11 holds it to 3:1. Controls use
   `border-input`; everything else uses `border`.
5. **`--accent` is one step off `--muted`.** They used to be byte-identical,
   which made `hover:bg-accent` invisible on any muted panel.

### Contrast floors

Every token is measured, not eyeballed. Text pairs clear **4.5:1** (AA), control
borders clear **3:1** (1.4.11). The ratios are written next to each value in
`globals.css`; if you change one, recompute it.

## Brand

`--primary` is the single source of truth for the brand blue. `themeColor` in
`src/app/layout.tsx` and `brand.DEFAULT` in `tailwind.config.ts` both derive from
it rather than restating an unrelated hex — there used to be four different
"brand" blues in three files.

The sidebar gradient (`--sidebar-blue`, `--sidebar-blue-mid`, and the
`.bg-brand-sidebar` utility) is a **separate decorative treatment**, not a fifth
brand colour. It is a deliberate multi-stop blue→teal→green ramp; leave it alone.

## Accessibility conventions

- **Every control gets a label.** `FormField` renders one and wires
  `aria-describedby` / `aria-invalid` / `aria-required` to the child
  automatically. Placeholders are not labels.
- **An error must be visible as well as announced.** `FormField`'s `error` sets
  `aria-invalid`, and `Input` / `Select` / `Textarea` paint a red border off it.
  Until Module 24 the Tailwind variant did not exist, so a failed field
  announced correctly and looked completely normal.
- **Colour is never the only signal.** A done step is green AND ticked AND says
  "Done" (`Stepper`); a current one carries `aria-current="step"`.
- **Every focusable thing shows focus.** If you wrap a component in a `<Link>` or
  a `<button>`, the ring has to move with it — a linked `StatTile` had none at
  all, because the ring lived on the card's children.
- **Every async result gets a live region.** `FormMessage` carries
  `role="status" aria-live="polite"` for success and `role="alert"` for failure.
  Without it a server action completes and a screen-reader user is told nothing.
- **Headings form an outline.** `PageHeader` renders the page's one `<h1>`;
  `CardTitle` renders `<h2>` by default and takes `level` when nested deeper.
- **Use logical properties, never physical.** `text-start` not `text-left`,
  `ms-`/`me-` not `ml-`/`mr-`, `ps-`/`pe-` not `pl-`/`pr-`. The dashboard shell
  sets `dir="rtl"` for Arabic companies and physical utilities do not flip.
- **Arrows mirror via `.dir-arrow`.** Defined in `globals.css`; `PageHeader`'s
  `backTo` uses it. Mark the glyph `aria-hidden`.

## Components

| Component         | Server-safe | Notes                                                     |
| ----------------- | :---------: | --------------------------------------------------------- |
| `Alert`           |     yes     | Standing notice. Tones `info`/`success`/`warning`/`danger`. |
| `Badge`           |     yes     | Adds `info`. All tones on triplets.                        |
| `Button`          |     yes     | Sizes share `Input`'s scale. `icon` / `icon-sm` / `icon-xs`. |
| `Card`            |     yes     | `CardTitle` → heading with `level`; `CardDescription` → `<p>`. |
| `CopyField`       |  **no**     | A value + a copy control. Reports a failed copy.           |
| `DescriptionList` |     yes     | `<dl>`. `inline` metadata run, or `rows`.                  |
| `EmptyState`      |     yes     | Drops into a `CardContent`.                                |
| `FieldGrid`       |     yes     | Responsive on the CONTAINER, not the viewport.             |
| `FormField`       |     yes     | Label + control + hint + error, wired. Sets `aria-invalid`. |
| `FormMessage`     |     yes     | The live region for action results.                        |
| `InfoHint`        |  **no**     | Click-to-open note. Not portalled — see its file.          |
| `Input`           |     yes     | Sizes `default` (40px) / `sm` (36px). Paints `aria-invalid`. |
| `Label`           |     yes     | Adds `required`. `block`, wrap-safe leading.               |
| `PageHeader`      |     yes     | `title`, `description`, `backTo`, `actions`.               |
| `PasswordInput`   |  **no**     | The composition pattern to copy. Read the file.            |
| `Progress`        |     yes     | Clamps centrally. `role="progressbar"`.                    |
| `SectionHeader`   |     yes     | A heading inside a page. `size` and `level` are separate.  |
| `Select`          |     yes     | Native `<select>`. Cannot truncate — mind the column width. |
| `Skeleton`        |     yes     | `aria-hidden`; set `aria-busy` on the container.           |
| `StatTile`        |     yes     | `label`, `value`, `hint`, `href`, `tone`, `delta`.         |
| `Stepper`         |     yes     | `rail` (progress) or `list` (checklist). For onboarding.   |
| `SubmitButton`    |  **no**     | `'use client'` — needs `useFormStatus`.                    |
| `Table`           |     yes     | `TableHead` is `text-start`. The wrapper is load-bearing.  |
| `Textarea`        |     yes     | `resize-y`. Paints `aria-invalid`.                         |
| `ThemeToggle`     |  **no**     | `labels="never"` when it sits in a narrow column.          |

Overlays — `Dialog`, `AlertDialog`, `Sheet`, `Popover`, `Tabs` — are all client
components, because a focus trap is. `TabLinks` is the server half of tabs and is
the default choice; see `tabs.tsx`.

The server-safe components still work inside a server-rendered
`<form action={serverAction}>`: the form stays a server component and only the
client pieces (`SubmitButton`, `CopyField`) hydrate.

### Composition traps

Read the file before wrapping one of these in another box.

- **`Input` inside a bordered wrapper → two radii.** `Input` carries its own
  `rounded-md`. Putting it inside a bordered `rounded-xl` row is what broke the
  password field, and it only showed once a browser autofilled it. `PasswordInput`
  is the fixed pattern: a `relative` wrapper with no box of its own, the trailing
  control `absolute inset-y-px end-px`, room reserved with `pe-*`.
- **`CardContent` bakes `pt-0`,** which assumes a `CardHeader` above it. A card
  with no header wants `<CardContent className="pt-6">`.
- **`Card` inside `Card` → two borders.** Use `rounded-md border bg-muted/30` for
  a panel inside a card.
- **`Card` in a grid needs `min-w-0`** on the track, or one long unbroken string
  widens the column and the page scrolls sideways.
- **`Select` cannot truncate.** A native select cuts its text mid-word at the
  control's edge; `truncate` does nothing to it. Lay the form out with
  `FieldGrid` and keep option labels short.
- **`Button` never wraps.** A long label overflows a narrow container instead.
  Keep labels short and let the container wrap the buttons.

### Why `Select` is native

20 of the 84 selects in this codebase sit in server components inside
`<form action={serverAction}>`, where the native element submits for free and
the page ships no JavaScript. A Radix select is a client component backed by a
hidden input, so adopting it would force those filter bars to hydrate for
nothing — and would add a dependency. Native also gets the platform picker on
mobile and correct RTL arrow placement for free.
