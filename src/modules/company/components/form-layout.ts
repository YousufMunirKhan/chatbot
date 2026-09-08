/**
 * Field grids that measure the COLUMN, not the viewport.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Tailwind's `sm: md: lg:` prefixes are viewport media queries. Almost every
 * form in this module can be rendered in two very different places:
 *
 *   - full width inside a `max-w-3xl` page (roughly 700px of content), and
 *   - inside the 1fr side of a `lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]`
 *     split on a `max-w-7xl` page, which is about 400px of content — and that
 *     split only exists at `lg:`, i.e. exactly when every `sm:` and `md:`
 *     prefix is already switched on.
 *
 * So `sm:grid-cols-3` on a component in that sidebar does not mean "three
 * columns when there is room for three". It means "three columns of ~120px,
 * guaranteed, on every desktop". That is how a `<select>` ended up clipping its
 * own text mid-word and a five-word label wrapped onto four lines. The whole of
 * `business-memory-forms.tsx` was capped at two columns for the same reason.
 *
 * `repeat(auto-fit, minmax(<floor>, 1fr))` is the honest version of the same
 * intent: plain CSS grid, no plugin, no new dependency, and it resolves against
 * the grid's own inline size. One column at 375px; two when the container can
 * actually give each field its floor; three only when it genuinely can. The
 * same class is therefore correct in the sidebar and at full width, which is
 * the property none of the `sm:` variants had.
 *
 * PICKING A FLOOR
 * ---------------
 * The floor is the narrowest the CONTROL may get before it stops working, not
 * the narrowest the label may get:
 *
 *   - `FIELD_GRID` (16rem / 256px) — the default. A `<select>` renders its
 *     longest option plus the platform arrow, and `Input`'s `px-3` padding, in
 *     256px without truncating.
 *   - `FIELD_GRID_WIDE` (20rem / 320px) — fields whose value is long and
 *     unbreakable: a card description, a URL, a token.
 *   - `FIELD_GRID_NARROW` (11rem / 176px) — numbers, hours, short codes.
 *   - `CHOICE_GRID` (17rem / 272px) — tick boxes and radio cards that carry a
 *     label AND a sentence of description. Below this the description wraps to
 *     four or five lines and the list stops being scannable.
 *
 * `gap-4` matches the `space-y-4` rhythm the README fixes for between-field
 * spacing, so a grid row and a stacked field sit on the same rhythm.
 */

/** Two-or-more field row. Collapses to one column in a narrow column or phone. */
export const FIELD_GRID =
  'grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(16rem,1fr))]';

/** For fields holding long unbreakable values — URLs, tokens, card descriptions. */
export const FIELD_GRID_WIDE =
  'grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(20rem,1fr))]';

/** For short numeric or coded fields — a day of the month, an hour, a currency code. */
export const FIELD_GRID_NARROW =
  'grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]';

/** For tick boxes and choice cards that carry a label plus a description. */
export const CHOICE_GRID =
  'grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(17rem,1fr))]';

/**
 * For tick boxes whose whole label is one or two words — "Name", "Email",
 * "Phone", "Auto-open on desktop". No description, so they pack much tighter
 * than `CHOICE_GRID`, but they still must not be given less room than the word
 * plus its box needs.
 */
export const TOGGLE_GRID =
  'grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(9rem,1fr))]';

/**
 * A tick box that carries a description, as a bordered target.
 *
 * The pattern was written out by hand in a dozen forms, in three different
 * paddings, and half of them put the `<input>` on the baseline of a two-line
 * label. `items-start` plus `mt-0.5` is the version that lines the box up with
 * the first line of the label at every wrap depth.
 */
export const CHOICE_CARD =
  'flex items-start gap-2.5 rounded-md border p-3 text-sm has-[:checked]:border-primary ' +
  // The 2px nudge that puts the box on the cap-height of the first line of the
  // label lives HERE and not on the box, so the same `CHECKBOX` class is also
  // correct in a table cell and beside a single-line label, where a top margin
  // would be a 2px misalignment instead of a correction.
  'has-[:checked]:bg-primary/5 [&>input]:mt-0.5';

/**
 * The box itself, inside a `CHOICE_CARD` or beside a one-line label.
 *
 * Works for `type="radio"` as well as `type="checkbox"`: both keep their native
 * appearance (a square and a circle respectively), and `accent-primary` is the
 * one property that recolours a native control without replacing it. The tick
 * boxes in this module were previously six different combinations of `h-4 w-4`,
 * `mt-0.5`, `mt-1` and `rounded border-input` — the last of which does nothing
 * at all to a control the browser is still painting itself. No margin here: see
 * `CHOICE_CARD`, which owns the offset for the one layout that needs it.
 */
export const CHECKBOX = 'h-4 w-4 shrink-0 accent-primary';

/**
 * A field that takes the whole row of whichever grid it is in.
 *
 * `col-span-2` CANNOT be used inside any of the grids above, and this is the
 * one sharp edge of the `auto-fit` approach. `repeat(auto-fit, …)` resolves to
 * however many columns fit — often one, in a narrow column or on a phone — and
 * an item asking to span two columns of a one-column grid makes the browser
 * create an implicit second track to satisfy it. The row then overflows the
 * container, which is the exact failure these grids exist to prevent.
 *
 * `grid-column: 1 / -1` says "first line to last line", which is the whole row
 * at any column count, including one. It also removes the `sm:`/`lg:` prefix
 * these spans used to carry — a viewport prefix on a span inside a
 * container-sized grid was two different measurements arguing.
 */
export const FULL_ROW = '[grid-column:1/-1]';

/**
 * A titled group inside a long form.
 *
 * "Long forms have sections with headings, not one 30-field wall." A `<section>`
 * with an `<h3>` gives a sighted reader the grouping and a screen-reader user
 * the outline entry; both were missing from every configuration form here.
 */
export const FORM_SECTION = 'space-y-4';

/**
 * `text-base font-semibold` because that is what the rest of the product
 * already uses for a heading inside a card — 19 places across the dashboard,
 * against six in `bot-form.tsx` that had invented a second style
 * (`text-sm uppercase tracking-wider text-muted-foreground`). Two visual
 * grammars for the same job is the exact "illogical" the owner is describing;
 * the majority one wins.
 */
export const FORM_SECTION_TITLE = 'text-base font-semibold';
export const FORM_SECTION_HINT = 'text-sm text-muted-foreground';
