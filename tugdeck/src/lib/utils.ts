import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Combines clsx conditional class logic with tailwind-merge conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
