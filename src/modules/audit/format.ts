/** Readability helper: condenses long opaque digests for audit *output* only. */
export function masked(value: string, head = 12, tail = 8): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}