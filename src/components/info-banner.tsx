/** Small inline notice — used to flag data that fills in once a later module ships. */
export function InfoBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      {children}
    </div>
  );
}
