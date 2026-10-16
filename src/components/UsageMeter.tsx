import type { UsageSummary } from '../../shared/api';
import { formatMinutes } from '../lib/format';

function Bar({ used, limit, label }: { used: number; limit: number; label: string }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 100;
  const tone = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok';
  return (
    <div className="usage-bar">
      <div className="usage-label">
        <span>{label}</span>
        <span>
          {formatMinutes(used)} / {formatMinutes(limit)} min
        </span>
      </div>
      <div
        className={`meter ${tone}`}
        role="meter"
        aria-label={`${label} usage`}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
      >
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function UsageMeter({ usage, compact = false }: { usage: UsageSummary; compact?: boolean }) {
  if (compact) {
    return (
      <div className="usage-compact" title={`This month: ${formatMinutes(usage.monthSeconds)} of ${formatMinutes(usage.monthLimitSeconds)} minutes`}>
        <span className="muted">Today</span>{' '}
        <strong>
          {formatMinutes(usage.daySeconds)}/{formatMinutes(usage.dayLimitSeconds)}
        </strong>{' '}
        <span className="muted">min</span>
      </div>
    );
  }
  return (
    <div className="usage">
      <Bar used={usage.daySeconds} limit={usage.dayLimitSeconds} label="Today" />
      <Bar used={usage.monthSeconds} limit={usage.monthLimitSeconds} label="This month" />
      <p className="hint">Limits reset at midnight ({usage.timeZone}).</p>
    </div>
  );
}
