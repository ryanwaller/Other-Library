export function formatDateShort(input: string | null | undefined): string {
  if (!input) return "—";
  const trimmed = String(input).trim();
  if (/^\d{4}$/.test(trimmed)) return trimmed;
  const yearOnlyDate = trimmed.match(/^(\d{4})-01-01$/);
  if (yearOnlyDate) return yearOnlyDate[1];
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) return String(input);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}
