const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec"
] as const;

function parseMonthYear(input: string): { year: string; month: string } | null {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return null;

  const monthYear = trimmed.match(/^(\d{1,2})[/-](\d{4})$/);
  if (monthYear) {
    const month = Number(monthYear[1]);
    if (month >= 1 && month <= 12) {
      return { month: String(month).padStart(2, "0"), year: monthYear[2]! };
    }
  }

  const yearMonth = trimmed.match(/^(\d{4})[/-](\d{1,2})$/);
  if (yearMonth) {
    const month = Number(yearMonth[2]);
    if (month >= 1 && month <= 12) {
      return { year: yearMonth[1]!, month: String(month).padStart(2, "0") };
    }
  }

  const monthName = trimmed.match(
    /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})$/i
  );
  if (monthName) {
    const monthKey = monthName[1]!.slice(0, 3).toLowerCase();
    const monthIndex = MONTHS.indexOf(monthKey as (typeof MONTHS)[number]);
    if (monthIndex >= 0) {
      return { month: String(monthIndex + 1).padStart(2, "0"), year: monthName[2]! };
    }
  }

  return null;
}

export function normalizeFlexiblePublishDate(input: string): string | null {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return null;
  if (/^\d{4}$/.test(trimmed)) return `${trimmed}-01-01`;

  const monthYear = parseMonthYear(trimmed);
  if (monthYear) return `${monthYear.year}-${monthYear.month}`;

  return trimmed;
}

export function formatDateShort(input: string | null | undefined): string {
  if (!input) return "—";
  const trimmed = String(input).trim();
  if (/^\d{4}$/.test(trimmed)) return trimmed;
  const yearOnlyDate = trimmed.match(/^(\d{4})-01-01$/);
  if (yearOnlyDate) return yearOnlyDate[1];

  const storedMonthYear = trimmed.match(/^(\d{4})-(\d{2})$/);
  if (storedMonthYear) {
    const monthIndex = Number(storedMonthYear[2]) - 1;
    if (monthIndex >= 0 && monthIndex < 12) {
      return `${MONTHS[monthIndex]!.charAt(0).toUpperCase()}${MONTHS[monthIndex]!.slice(1)} ${storedMonthYear[1]}`;
    }
  }

  const parsedMonthYear = parseMonthYear(trimmed);
  if (parsedMonthYear) {
    const monthIndex = Number(parsedMonthYear.month) - 1;
    return `${MONTHS[monthIndex]!.charAt(0).toUpperCase()}${MONTHS[monthIndex]!.slice(1)} ${parsedMonthYear.year}`;
  }

  const date = new Date(trimmed);
  if (!Number.isFinite(date.getTime())) return String(input);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}
