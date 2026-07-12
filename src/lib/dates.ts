// Small date helpers scoped to church-timezone concerns.

/**
 * Returns "today" as YYYY-MM-DD in the given IANA timezone (falls back to UTC
 * on invalid input). Used by operator surfaces to match `servicePlans.scheduledFor`
 * (a date-only column) in the church's local sense of "today" rather than the
 * server's UTC.
 */
export function getTodayInChurchTz(tz: string | null | undefined): string {
  const zone = tz && typeof tz === "string" ? tz : "UTC";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }
}
