import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  azureServiceCatalog,
  getServiceCategories,
  type ServiceCategory,
  type ServiceDefinition,
} from '@aar/shared';
import { categoryColor } from '@/lib/icons.js';
import { ServiceIcon } from '@/components/ServiceIcon.js';
import { cn } from '@/lib/utils.js';

const categoryLabels: Record<ServiceCategory, string> = {
  compute: 'Compute',
  containers: 'Containers',
  web: 'Web',
  databases: 'Databases',
  storage: 'Storage',
  networking: 'Networking',
  ai: 'AI',
  analytics: 'Analytics',
  integration: 'Integration',
  security: 'Security',
  identity: 'Identity',
  devops: 'DevOps',
  management: 'Management',
};

/** Left palette: searchable, categorized list of draggable Azure services. */
export function Palette(): JSX.Element {
  const [query, setQuery] = useState('');

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (s: ServiceDefinition) =>
      !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
    return getServiceCategories()
      .map((category) => ({
        category,
        services: azureServiceCatalog.filter((s) => s.category === category && match(s)),
      }))
      .filter((g) => g.services.length > 0);
  }, [query]);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card" aria-label="Service palette">
      <div className="border-b border-border p-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search services…"
            aria-label="Search services"
            className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {grouped.map(({ category, services }) => (
          <div key={category} className="mb-3">
            <div className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {categoryLabels[category]}
            </div>
            <ul className="space-y-1">
              {services.map((s) => {
                return (
                  <li key={s.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/x-aar-service', s.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      title={s.description}
                      className="flex cursor-grab items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm hover:border-border hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                    >
                      <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted', categoryColor[s.category])}>
                        <ServiceIcon category={s.category} slug={s.icon} size={14} />
                      </span>
                      <span className="truncate">{s.name}</span>
                      {s.draft && (
                        <span
                          title="Auto-detected candidate awaiting curation"
                          className="ml-auto shrink-0 rounded border border-sky-500/30 bg-sky-500/15 px-1 py-0.5 text-[9px] font-medium uppercase text-sky-600 dark:text-sky-400"
                        >
                          New
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {grouped.length === 0 && (
          <p className="px-1 py-4 text-sm text-muted-foreground">No services match “{query}”.</p>
        )}
      </div>
    </aside>
  );
}
