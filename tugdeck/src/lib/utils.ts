import { clsx, type ClassValue } from "clsx";

/** Combines class values using clsx conditional class logic. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
