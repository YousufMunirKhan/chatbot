import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Select } from '@/components/ui/select';
import type { ActivityActionOption, ActivityActorOption, ActivityFilters } from '@/modules/company/audit-data';

/**
 * The activity log's filter bar.
 *
 * A plain GET form, exactly like the leads and orders bars: no JavaScript, the
 * result is bookmarkable and shareable ("here is the week Sara was removed"),
 * and the back button behaves. It is NOT `ListFilters` from `list-controls`
 * because that one submits `q` and `status`, and this page filters on four
 * different things — sharing the component would have meant bending it into a
 * generic filter builder to serve two call sites.
 *
 * The two dropdowns are built from what this company's log actually contains,
 * so neither of them can offer a choice that returns nothing.
 */

const ACTOR_ID = 'activity-filter-actor';
const TYPE_ID = 'activity-filter-type';
const FROM_ID = 'activity-filter-from';
const TO_ID = 'activity-filter-to';

// The filter bar runs its controls at 36px; `Input` is fixed at 40px with no
// size variant, which is why the date boxes are bare elements here — the same
// exception `list-controls` documents for its search box.
const dateCls =
  'flex h-9 w-40 rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function AuditFilters({
  basePath,
  filters,
  actors,
  actions,
  timezone,
}: {
  basePath: string;
  filters: ActivityFilters;
  actors: ActivityActorOption[];
  actions: ActivityActionOption[];
  /** Which clock the two date boxes are counted on. */
  timezone: string;
}) {
  const isFiltered = Boolean(filters.actor || filters.type || filters.from || filters.to);

  return (
    <form method="get" action={basePath} className="flex flex-wrap items-end gap-2">
      <FormField label="Who" htmlFor={ACTOR_ID}>
        <Select size="sm" name="actor" defaultValue={filters.actor ?? ''} className="w-auto">
          <option value="">Anyone</option>
          {actors.map((actor) => (
            <option key={actor.value} value={actor.value}>
              {actor.label}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label="What happened" htmlFor={TYPE_ID}>
        <Select size="sm" name="type" defaultValue={filters.type ?? ''} className="w-auto">
          <option value="">Everything</option>
          {actions.map((action) => (
            <option key={action.value} value={action.value}>
              {action.label}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label="From" htmlFor={FROM_ID} hint={`Dates are counted in ${timezone}.`}>
        <input type="date" name="from" defaultValue={filters.from ?? ''} className={dateCls} />
      </FormField>

      <FormField label="To" htmlFor={TO_ID}>
        <input type="date" name="to" defaultValue={filters.to ?? ''} className={dateCls} />
      </FormField>

      <Button type="submit" variant="outline" size="sm">
        Filter
      </Button>
      {isFiltered ? (
        <Button asChild variant="ghost" size="sm">
          <Link href={basePath}>Clear</Link>
        </Button>
      ) : null}
    </form>
  );
}
