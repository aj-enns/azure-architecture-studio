import type { ServiceCategory } from '@aas/shared';
import { Box, Cloud, UserRound } from 'lucide-react';
import { azureIconUrl, categoryColor, iconForCategory } from '@/lib/icons.js';
import { cn } from '@/lib/utils.js';

interface ServiceIconProps {
  category: ServiceCategory;
  /** Catalog `icon` slug; used to look up the official Azure SVG. */
  slug?: string;
  /** True for a non-Azure component: render a neutral generic glyph. */
  external?: boolean;
  size?: number;
  className?: string;
}

/**
 * Renders the official Microsoft Azure icon for a service when its SVG has been
 * bundled, otherwise falls back to the tinted Lucide category glyph.
 */
export function ServiceIcon({
  category,
  slug,
  external,
  size = 18,
  className,
}: ServiceIconProps): JSX.Element {
  if (external) {
    return <Box size={size} aria-hidden className={cn('text-muted-foreground', className)} />;
  }
  if (slug === 'browser-user') {
    return (
      <span
        aria-hidden
        className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
        style={{ width: size, height: size }}
      >
        <Cloud size={size} strokeWidth={1.8} className="absolute text-sky-500" />
        <UserRound
          size={Math.max(8, Math.round(size * 0.45))}
          strokeWidth={2.2}
          className="absolute top-[42%] text-sky-700 dark:text-sky-300"
        />
      </span>
    );
  }

  const url = azureIconUrl(slug);
  if (url) {
    return (
      <img
        src={url}
        alt=""
        aria-hidden
        width={size}
        height={size}
        className={cn('object-contain', className)}
        draggable={false}
      />
    );
  }
  const Icon = iconForCategory(category);
  return <Icon size={size} aria-hidden className={cn(categoryColor[category], className)} />;
}
