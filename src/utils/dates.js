// Local-calendar date helpers. `created_at` is stored in UTC, so slicing the ISO
// string gives the UTC day: in Pakistan (UTC+5) anything before 05:00 lands on
// the previous date. Use these instead of `toISOString().slice(0, 10)`.

const pad = (n) => String(n).padStart(2, '0')

// 'YYYY-MM-DD' of a Date / ISO string in the device's local time zone
export function localDateKey(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d)) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Today's local date, for <input type="date"> defaults
export const todayLocal = () => localDateKey(new Date())

// Timestamp for a manual ledger entry dated `dateStr` ('YYYY-MM-DD', local):
// today → the current time (keeps entries in the order they were made);
// another day → local noon of that day.
export function entryTimestamp(dateStr) {
  if (!dateStr || dateStr === todayLocal()) return new Date().toISOString()
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0).toISOString()
}
