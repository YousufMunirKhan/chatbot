'use client';

import * as React from 'react';
import { FormField } from '@/components/ui/form-field';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { CHECKBOX, CHOICE_CARD, CHOICE_GRID } from './form-layout';

/**
 * The role picker and the permission tick list, shared by the invite form and
 * the per-person editor (migration 0080).
 *
 * WHY EVERYTHING ARRIVES AS PROPS
 * -------------------------------
 * The permission catalogue lives in `src/lib/permissions.ts`, which reads the
 * session and the service-role database client. A `'use client'` module cannot
 * import that at any price, so the server component that renders this passes
 * the labels, the groups and the role defaults down as plain data. Nothing here
 * decides anything: the same rules run again in the server action, because a
 * form component imports that action directly and a control that was never
 * drawn stops nobody.
 *
 * WHY THE TICK BOXES MOVE WHEN THE ROLE DOES
 * ------------------------------------------
 * A role is a starting point, not a label. Choosing "Team member" re-ticks that
 * role's defaults so the person setting access can see what they are about to
 * hand over before they adjust it — otherwise the list would still be showing
 * the previous role's answers and the difference between the two would be
 * invisible until after the invitation went out.
 */

export interface AccessRoleOption {
  value: string;
  label: string;
  description: string;
  /** The permissions this role carries with no adjustments at all. */
  defaults: string[];
}

export interface AccessPermissionOption {
  key: string;
  label: string;
  description: string;
}

export interface AccessGroupOption {
  key: string;
  group: string;
  permissions: AccessPermissionOption[];
}

export interface AgentAccessFieldsProps {
  /** Unique within the page — several of these render at once on the Team page. */
  idPrefix: string;
  roles: AccessRoleOption[];
  groups: AccessGroupOption[];
  /**
   * What the person filling this in can do themselves. Anything outside it is
   * shown but not selectable: they cannot hand out access they do not hold, and
   * saying so on the control is kinder than saying it in an error afterwards.
   */
  manageable: string[];
  initialRole: string;
  initialGranted: string[];
}

export function AgentAccessFields({
  idPrefix,
  roles,
  groups,
  manageable,
  initialRole,
  initialGranted,
}: AgentAccessFieldsProps) {
  const held = React.useMemo(() => new Set(manageable), [manageable]);
  const [role, setRole] = React.useState(initialRole);
  const [granted, setGranted] = React.useState<Set<string>>(() => new Set(initialGranted));

  const onRoleChange = (next: string) => {
    setRole(next);
    const defaults = roles.find((r) => r.value === next)?.defaults ?? [];
    // Intersected with what this person holds, so switching role can never leave
    // a box ticked that the server is about to refuse.
    setGranted(new Set(defaults.filter((key) => held.has(key))));
  };

  const toggle = (key: string, on: boolean) => {
    setGranted((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const active = roles.find((r) => r.value === role);

  return (
    <div className="space-y-4">
      <FormField
        label="Role"
        htmlFor={`${idPrefix}-role`}
        required
        hint={active?.description}
      >
        <Select
          name="role"
          value={role}
          onChange={(event) => onRoleChange(event.target.value)}
        >
          {roles.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </FormField>

      <fieldset className="space-y-4">
        <legend className="text-sm font-medium">What they can do</legend>
        <p className="text-xs text-muted-foreground">
          The role above sets these for you. Change any of them to make this person an
          exception — only the differences are saved, so if you later change what the role
          can do, they follow it.
        </p>
        {groups.map((group) => (
          <div key={group.key} className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.group}
            </p>
            {/*
              `CHOICE_GRID`, not `sm:grid-cols-2`. This list renders in two very
              different containers and the viewport prefix was wrong in both.
              On the Team page it is inside the 1fr side of a 1.7fr/1fr split on
              a `max-w-7xl` page — about 400px wide, at a viewport where `sm:`
              is long since on, so each tick box got ~190px to hold a label AND
              a sentence of description. It is ALSO rendered inside a table cell
              by `AgentAccessForm`, which is narrower still. `auto-fit` gives one
              column in both of those and two only where two genuinely fit.
            */}
            <div className={CHOICE_GRID}>
              {group.permissions.map((permission) => {
                const allowed = held.has(permission.key);
                return (
                  <label
                    key={permission.key}
                    className={cn(
                      CHOICE_CARD,
                      // A permission you cannot hand out is not a choice, so it
                      // does not get the checked tint or the pointer.
                      !allowed && 'cursor-not-allowed bg-muted/40 text-muted-foreground',
                    )}
                  >
                    <input
                      type="checkbox"
                      name="permissions"
                      value={permission.key}
                      checked={granted.has(permission.key)}
                      disabled={!allowed}
                      onChange={(event) => toggle(permission.key, event.target.checked)}
                      className={CHECKBOX}
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">{permission.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {allowed
                          ? permission.description
                          : 'You cannot give this to somebody else because you do not have it yourself.'}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </fieldset>
    </div>
  );
}
