/**
 * Normalize swimmer name to consistent "First Last" format
 * Handles input in either "First Last" or "Last, First" format
 */
export const normalizeSwimmerName = (name: string): { firstLast: string; lastFirst: string } => {
  const trimmed = name.trim();

  if (trimmed.includes(',')) {
    // Input is "Last, First" format - split and swap
    const [last, first] = trimmed.split(',').map((s) => s.trim());
    return {
      firstLast: `${first} ${last}`,
      lastFirst: `${last}, ${first}`,
    };
  }

  // Input is "First Last" format - split and create both
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    const first = parts.slice(0, -1).join(' ');
    const last = parts[parts.length - 1];
    return {
      firstLast: trimmed,
      lastFirst: `${last}, ${first}`,
    };
  }

  // Single name - use as-is for both
  return { firstLast: trimmed, lastFirst: trimmed };
};
