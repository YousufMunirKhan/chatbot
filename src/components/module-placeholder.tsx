import { Card, CardContent } from '@/components/ui/card';

/**
 * Standard placeholder for a page whose functionality is delivered by a later
 * module. Keeps the dashboard navigable and self-documenting before that module
 * is built.
 */
export function ModulePlaceholder({
  title,
  module,
  description,
  features,
}: {
  title: string;
  module: string;
  description: string;
  features?: string[];
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Card>
        <CardContent className="space-y-3 py-8 text-center">
          <p className="text-sm font-medium">Coming in {module}</p>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            This area is part of <strong>{module}</strong>. The page and navigation are in place;
            functionality lands when that module is built.
          </p>
          {features && features.length > 0 ? (
            <ul className="mx-auto max-w-md list-inside list-disc text-left text-sm text-muted-foreground">
              {features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
