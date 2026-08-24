// Timezone-correct date/time helpers.
//
// Why this file exists: hosting platforms run their servers on UTC, so
// `new Date().toISOString().split('T')[0]` and `date.setHours(9, 0)` both
// silently operate in UTC rather than the timezone the business actually
// works in. For an Indian facility company (UTC+5:30) that made every
// stored date, every displayed time, and every late/early-departure
// decision wrong by 5h30m — an 09:05 IST clock-in rendered as "03:35",
// filed under the wrong calendar date if it happened before 05:30 IST, and
// never marked late until 14:40 IST.
//
// Everything here derives the wall-clock calendar/time *in a named
// timezone* from a real instant, using Intl, so it is correct regardless
// of what the server's own clock is set to. Nothing in this file reads
// the server's local timezone.
const DEFAULT_TZ = process.env.APP_TIMEZONE || 'Asia/Kolkata';

// `hourCycle: 'h23'` rather than `hour12: false` — the latter renders
// midnight as "24" on some ICU builds, which breaks arithmetic silently.
const PARTS_FORMATTERS = new Map();
function partsFormatter(timeZone) {
  let fmt = PARTS_FORMATTERS.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    PARTS_FORMATTERS.set(timeZone, fmt);
  }
  return fmt;
}

// Wall-clock calendar parts for `instant`, as seen in `timeZone`.
function zonedParts(instant, timeZone = DEFAULT_TZ) {
  const parts = partsFormatter(timeZone).formatToParts(new Date(instant));
  const out = {};
  for (const { type, value } of parts) {
    if (type !== 'literal') out[type] = Number(value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour,
    minute: out.minute,
    second: out.second,
  };
}

// 'YYYY-MM-DD' for the given instant *in the business timezone*. This is
// the value that belongs in AttendanceLog.date — the day the work actually
// happened, as the people doing it would name it.
function businessDate(instant = new Date(), timeZone = DEFAULT_TZ) {
  const { year, month, day } = zonedParts(instant, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// 'HH:MM' (24h) in the business timezone — for anything a human reads:
// kiosk confirmations, CSV exports, notification emails.
function businessTime(instant = new Date(), timeZone = DEFAULT_TZ) {
  const { hour, minute } = zonedParts(instant, timeZone);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// 'YYYY-MM-DD HH:MM' — a single unambiguous stamp for CSV columns.
function businessDateTime(instant = new Date(), timeZone = DEFAULT_TZ) {
  return `${businessDate(instant, timeZone)} ${businessTime(instant, timeZone)}`;
}

// Minutes elapsed since local midnight, in the business timezone. This is
// the unit all shift comparisons use: comparing two integers on the same
// scale removes every opportunity for a timezone to leak into the maths.
function minutesSinceMidnight(instant = new Date(), timeZone = DEFAULT_TZ) {
  const { hour, minute } = zonedParts(instant, timeZone);
  return hour * 60 + minute;
}

// 'HH:MM' -> minutes since midnight. Returns null for anything malformed
// so callers can treat a bad shift template as "no shift configured"
// rather than computing against NaN (which compares false against
// everything and would quietly mark nobody late).
function parseHHMM(hhmm) {
  if (typeof hhmm !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

// Offset (ms) that must be *subtracted* from a UTC-interpreted wall clock
// to get the true instant. Derived by round-tripping the instant through
// the zone rather than hardcoding +5:30, so this stays correct for zones
// that observe DST.
function zoneOffsetMs(instant, timeZone = DEFAULT_TZ) {
  const p = zonedParts(instant, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - new Date(instant).getTime();
}

// Build the real UTC instant for a wall-clock time in the business
// timezone — the inverse of zonedParts. Used to turn "this shift ends at
// 06:00 on the day after clock-in" into an actual comparable Date.
//
// The second offset lookup handles the DST case: the offset that applies
// at the *resulting* instant can differ from the offset at the initial
// guess (only near a transition). India never hits this; other zones do.
function instantFromZonedParts({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone = DEFAULT_TZ) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = zoneOffsetMs(new Date(guess), timeZone);
  let ts = guess - firstOffset;
  const secondOffset = zoneOffsetMs(new Date(ts), timeZone);
  if (secondOffset !== firstOffset) ts = guess - secondOffset;
  return new Date(ts);
}

// The UTC instant of local midnight on a 'YYYY-MM-DD' business date.
// Anchors day-boundary range queries (start-of-day / end-of-day) that must
// not drift with the server's own zone.
function startOfBusinessDay(dateStr, timeZone = DEFAULT_TZ) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) throw new Error(`Invalid business date: ${dateStr}`);
  return instantFromZonedParts(
    { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) },
    timeZone
  );
}

// Exclusive end of a business day (i.e. next local midnight).
function endOfBusinessDay(dateStr, timeZone = DEFAULT_TZ) {
  const start = startOfBusinessDay(dateStr, timeZone);
  // Add 26h then snap back to that day's local midnight — robust across a
  // DST transition, where a day is not always exactly 24h long.
  const roughlyNextDay = new Date(start.getTime() + 26 * 60 * 60 * 1000);
  return startOfBusinessDay(businessDate(roughlyNextDay, timeZone), timeZone);
}

// Shift `dateStr` by whole calendar days in the business timezone.
// Calendar-aware, so it can't land on a nonexistent local time.
function addBusinessDays(dateStr, days, timeZone = DEFAULT_TZ) {
  const base = startOfBusinessDay(dateStr, timeZone);
  // Midday anchor keeps the arithmetic clear of any midnight DST shift.
  const anchored = new Date(base.getTime() + 12 * 60 * 60 * 1000 + days * 24 * 60 * 60 * 1000);
  return businessDate(anchored, timeZone);
}

// Descending list of the last `count` business dates, today first.
function recentBusinessDates(count, timeZone = DEFAULT_TZ) {
  const today = businessDate(new Date(), timeZone);
  const dates = [];
  for (let i = 0; i < count; i++) dates.push(addBusinessDays(today, -i, timeZone));
  return dates;
}

// 0 = Sunday … 6 = Saturday, in the business timezone. Needed for weekly
// offs: the server's own day-of-week can differ from the site's.
function businessDayOfWeek(instant = new Date(), timeZone = DEFAULT_TZ) {
  const p = zonedParts(instant, timeZone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

module.exports = {
  DEFAULT_TZ,
  zonedParts,
  businessDate,
  businessTime,
  businessDateTime,
  minutesSinceMidnight,
  parseHHMM,
  instantFromZonedParts,
  startOfBusinessDay,
  endOfBusinessDay,
  addBusinessDays,
  recentBusinessDates,
  businessDayOfWeek,
};
