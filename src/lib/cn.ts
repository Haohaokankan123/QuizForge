/**
 * cn — tiny className combiner.
 *
 * Dependency-free join of class values: filters out falsy entries (false,
 * null, undefined, '') so conditional classes read cleanly:
 *   cn('base', isActive && 'active', error ? 'border-destructive' : null)
 *
 * Note: this does NOT de-dupe conflicting Tailwind utilities (no tailwind-merge
 * is installed). Author component classes so the caller's `className` comes LAST
 * in the merged string, letting later utilities win via normal CSS source order.
 */
export type ClassValue = string | number | false | null | undefined;

export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(" ");
}
