import type { JSX } from 'react';

import { intensityLevel, monthLabel } from './overview-format.js';
import type { TerritoryOverviewMonth } from '../../api/client.js';

export interface MonthStripProps {
  readonly monthly: readonly TerritoryOverviewMonth[];
}

/**
 * Twelve blocks, oldest to newest, encoding visits per month as colour
 * intensity. This is the whole point of the overview: a single month's count
 * cannot show consistency, a series can.
 *
 * The strip encodes numbers as colour, and this app's definition of done
 * requires keyboard and screen-reader operability — so it carries role="img"
 * with the series stated in words. Without that the information would exist
 * only for sighted users.
 */
export function MonthStrip({ monthly }: MonthStripProps): JSX.Element {
  const spoken = monthly.map((month) => `${monthLabel(month.month)}: ${month.times}`).join(', ');

  return (
    <span className="month-strip" role="img" aria-label={`Actividad mensual — ${spoken}`}>
      {monthly.map((month) => (
        <span
          key={month.month}
          className={`month-strip-block level-${intensityLevel(month.times)}`}
          title={`${monthLabel(month.month)}: ${month.times === 1 ? '1 vez' : `${month.times} veces`}`}
        />
      ))}
    </span>
  );
}
