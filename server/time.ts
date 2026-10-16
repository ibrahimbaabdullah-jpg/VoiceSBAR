const formatters = new Map<string, Intl.DateTimeFormat>();

/** Calendar keys for usage limits, e.g. { day: "2026-10-15", month: "2026-10" }, in `timeZone`. */
export function periodKeys(nowMs: number, timeZone: string): { day: string; month: string } {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timeZone, fmt);
  }
  const parts = Object.fromEntries(fmt.formatToParts(new Date(nowMs)).map((p) => [p.type, p.value]));
  const month = `${parts.year}-${parts.month}`;
  return { day: `${month}-${parts.day}`, month };
}

export const nowSeconds = (nowMs: number) => Math.floor(nowMs / 1000);
