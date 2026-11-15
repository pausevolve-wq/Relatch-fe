import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// The standard shadcn class combiner that registry components (Magic UI, etc.) import.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
