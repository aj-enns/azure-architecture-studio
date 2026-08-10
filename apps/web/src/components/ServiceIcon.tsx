import type { ServiceCategory } from '@aar/shared';
import { azureIconUrl, categoryColor, iconForCategory } from '@/lib/icons.js';
import { cn } from '@/lib/utils.js';

interface ServiceIconProps {
  category: ServiceCategory;
  /** Catalog `icon` slug; used to look up the official Azure SVG. */
  slug?: string;
  size?: number;
  className?: string;
}

/**
 * Renders the official Microsoft Azure icon for a service when its SVG has been
 * bundled, otherwise falls back to the tinted Lucide category glyph.
 */
export function ServiceIcon({ category, slug, size = 18, className }: ServiceIconProps): JSX.Element {
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
