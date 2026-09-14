import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils.js';

/**
 * Lightweight dropdown menu: a trigger button that toggles a floating panel of
 * items. Closes on outside click, Escape, or when an item is selected.
 */
export function DropdownMenu({
  trigger,
  children,
  align = 'end',
  side = 'bottom',
  closeOnSelect = true,
  label,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
  side?: 'top' | 'bottom';
  closeOnSelect?: boolean;
  label?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <div onClick={() => setOpen((v) => !v)}>{trigger}</div>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={cn(
            'absolute z-50 min-w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg',
            side === 'top' ? 'bottom-full mb-1' : 'top-full mt-1',
            align === 'end' ? 'right-0' : 'left-0',
          )}
          onClick={() => {
            if (closeOnSelect) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** A selectable row inside a DropdownMenu. */
export function DropdownItem({
  onSelect,
  children,
  className,
}: {
  onSelect: () => void;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** A checked row for independently toggled menu options. */
export function DropdownCheckboxItem({
  checked,
  onCheckedChange,
  children,
}: {
  checked: boolean;
  onCheckedChange: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onCheckedChange}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        className={cn(
          'flex h-3.5 w-3.5 items-center justify-center rounded-sm border text-[10px] font-bold',
          checked
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-muted-foreground/50',
        )}
        aria-hidden
      >
        {checked ? '✓' : ''}
      </span>
      {children}
    </button>
  );
}
