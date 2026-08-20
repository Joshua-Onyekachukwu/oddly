import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names with Tailwind CSS conflict resolution.
 * Combines clsx (conditional classes) with tailwind-merge (deduplication).
 *
 * @example
 * cn("px-4 py-2", isActive && "bg-primary", className)
 * cn("text-sm", "text-lg") // → "text-lg" (last wins)
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Focus ring utility — consistent focus-visible across all interactive elements.
 */
export const focusRing = cn(
  "focus-visible:outline-none focus-visible:ring-2",
  "focus-visible:ring-ring focus-visible:ring-offset-2"
);

/**
 * Disabled utility — consistent disabled state across all interactive elements.
 */
export const disabled = "disabled:pointer-events-none disabled:opacity-50";
