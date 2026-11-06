import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge the app's type scale (text-12 … text-56), or it would read them as colours
// and drop them whenever a text colour class follows.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["12", "13", "14", "16", "20", "28", "44", "56"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
