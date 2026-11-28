import { startOfIndiaDay } from './shop-board';

const DAY_MS = 86_400_000;
const INDIA_OFFSET_MS = 330 * 60_000;

export function indiaDateKey(value: string | Date): string {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? new Date(time + INDIA_OFFSET_MS).toISOString().slice(0, 10) : '';
}

/** Calendar-day boundaries are Asia/Kolkata, regardless of server timezone. */
export function shopReportPeriod(days: number, now = new Date()) {
  const start = Date.parse(startOfIndiaDay(now)) - (days - 1) * DAY_MS;
  return {
    since: new Date(start).toISOString(),
    dates: Array.from({ length: days }, (_, index) => {
      const date = new Date(start + index * DAY_MS);
      return { key: indiaDateKey(date), label: new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(date) };
    }),
  };
}
