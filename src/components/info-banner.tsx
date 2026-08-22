import { Alert } from '@/components/ui/alert';

/**
 * Small inline notice — used to flag data that fills in once a later module
 * ships.
 *
 * Module 22: now a thin wrapper over `Alert`, which fixes the dark-mode bug
 * (the old hardcoded `bg-amber-50` / `text-amber-900` never flipped) without
 * changing the amber reading of the existing call sites. New code should reach
 * for `Alert` directly, which offers the info/success/danger tones too.
 */
export function InfoBanner({ children }: { children: React.ReactNode }) {
  return <Alert tone="warning">{children}</Alert>;
}
