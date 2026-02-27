export function formatDateShort(input: string | null | undefined): string {
  if (!input) return "—";
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) return String(input);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}
