/** Accept comma-separated invoice numbers and inclusive ranges. */
export function parseSkipNumbers(input: string): {
  numbers: number[];
  error: string;
} {
  if (!input.trim()) return { numbers: [], error: "" };
  if (input.length > 10000)
    return {
      numbers: [],
      error: "Use a shorter list, or combine numbers into ranges.",
    };
  const excluded = new Uint8Array(100000);
  for (const part of input.split(",")) {
    const match = part.trim().match(/^(\d{1,5})(?:\s*[-–—]\s*(\d{1,5}))?$/);
    if (!match)
      return {
        numbers: [],
        error: "Use numbers or ranges separated by commas, like 142, 145-148.",
      };
    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    if (first > last)
      return {
        numbers: [],
        error: "Ranges must go from smaller to larger, like 145-148.",
      };
    excluded.fill(1, first, last + 1);
  }
  const numbers: number[] = [];
  excluded.forEach((value, number) => {
    if (value) numbers.push(number);
  });
  return { numbers, error: "" };
}

export function firstAvailableNumber(
  start: number,
  skipped: number[],
): number | null {
  let next = start;
  // parseSkipNumbers returns unique numbers in ascending order.
  for (const number of skipped) {
    if (number === next) next++;
    else if (number > next) break;
  }
  return next <= 99999 ? next : null;
}
