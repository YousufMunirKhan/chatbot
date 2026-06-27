'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface BusinessDataTab {
  key: string;
  label: string;
  helper: string;
  badge?: string;
  content: ReactNode;
}

export function BusinessDataTabs({ tabs }: { tabs: BusinessDataTab[] }) {
  const searchParams = useSearchParams();
  const paramTab = searchParams.get('tab');
  const firstKey = tabs[0]?.key ?? '';
  const initialKey = tabs.some((tab) => tab.key === paramTab) ? (paramTab as string) : firstKey;
  const [active, setActive] = useState(initialKey);
  useEffect(() => {
    if (initialKey) setActive(initialKey);
  }, [initialKey]);
  const activeTab = tabs.find((tab) => tab.key === active) ?? tabs[0];
  if (!activeTab) return null;

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto border-b">
        <div role="tablist" aria-label="Business data sections" className="flex min-w-max gap-1">
          {tabs.map((tab) => {
            const selected = tab.key === activeTab.key;
            return (
              <Link
                key={tab.key}
                href={`?tab=${encodeURIComponent(tab.key)}`}
                role="tab"
                aria-selected={selected}
                onClick={() => setActive(tab.key)}
                className={cn(
                  'border-b-2 px-3 py-3 text-left text-sm transition-colors',
                  selected
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="font-medium">{tab.label}</span>
                {tab.badge ? (
                  <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {tab.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        {activeTab.helper}
      </div>

      <div role="tabpanel">{activeTab.content}</div>
    </div>
  );
}
