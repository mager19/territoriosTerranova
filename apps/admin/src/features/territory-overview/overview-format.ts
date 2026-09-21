/**
 * Pure formatting for the overview. Kept apart from the components so it can
 * be unit tested — the admin app has no component-test harness, so this is
 * the layer where the view's real logic is proven.
 *
 * Month names are a hardcoded array rather than Intl/toLocaleString: Node's
 * locale data varies with the ICU build, which would make these tests pass or
 * fail depending on the machine.
 */

const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre'
];

/** Four levels, because the strip encodes counts as colour and more steps than this stop being distinguishable at 12px. */
export function intensityLevel(times: number): 0 | 1 | 2 | 3 {
  if (times <= 0) return 0;
  if (times === 1) return 1;
  if (times <= 3) return 2;
  return 3;
}

export function monthLabel(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const year = match[1];
  const monthIndex = Number(match[2]) - 1;
  const name = MONTH_NAMES[monthIndex];
  if (name === undefined) return month;
  return `${name} ${year}`;
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function describeLastWorked(lastWorkedAt: string | null, now: Date): string {
  if (lastWorkedAt === null) return 'nunca';
  const then = new Date(lastWorkedAt);
  if (Number.isNaN(then.getTime())) return 'nunca';

  const days = Math.floor((now.getTime() - then.getTime()) / MILLISECONDS_PER_DAY);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'hace 1 día';
  if (days < 30) return `hace ${days} días`;

  const months = Math.floor(days / 30);
  return months === 1 ? 'hace 1 mes' : `hace ${months} meses`;
}

export function formatHectares(areaHectares: number | null): string {
  if (areaHectares === null) return '—';
  return `${areaHectares.toFixed(2)} ha`;
}
