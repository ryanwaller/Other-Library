export type MagazineLike = {
  object_type?: string | null;
  issue_number?: string | null;
  issue_volume?: string | null;
  issue_season?: string | null;
  issue_year?: number | string | null;
  issn?: string | null;
};

export type MagazineMetadata = {
  issue_number: string | null;
  issue_volume: string | null;
  issue_season: string | null;
  issue_year: number | null;
  issn: string | null;
};

export type ParsedMagazineTitle = {
  publicationName: string;
  issueNumber: string | null;
  issueVolume: string | null;
  issueSeason: string | null;
  issueYear: number | null;
  flagged: boolean;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export function emptyMagazineMetadata(): MagazineMetadata {
  return {
    issue_number: null,
    issue_volume: null,
    issue_season: null,
    issue_year: null,
    issn: null
  };
}

export function isMagazineObject(value: unknown): boolean {
  return clean(value).toLowerCase() === "magazine";
}

export function displayObjectTypeLabel(value: unknown): string {
  const normalized = clean(value).toLowerCase();
  if (normalized === "magazine") return "periodical";
  return normalized;
}

export function normalizeIssn(input: string): string {
  const raw = input.trim().toUpperCase().replace(/[^0-9X]/g, "");
  if (raw.length !== 8) return raw;
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function looksLikeIssn(input: string): boolean {
  return /^\d{4}-\d{3}[\dX]$/i.test(input.trim()) || /^\d{7}[\dX]$/i.test(input.trim().replace(/[^0-9X]/gi, ""));
}

export function formatIssueDisplay(book: MagazineLike | null | undefined): string {
  if (!book) return "";
  const volume = clean(book.issue_volume);
  const issueNumber = clean(book.issue_number);
  const season = clean(book.issue_season);
  const yearRaw = clean(book.issue_year);
  const year = /^\d{4}$/.test(yearRaw) ? yearRaw : "";

  const parts: string[] = [];
  if (volume) parts.push(`Vol. ${volume}`);
  if (issueNumber) {
    const lowered = issueNumber.toLowerCase();
    const prefixed = /^(issue|no\.?|#)\b/.test(lowered);
    parts.push(prefixed ? issueNumber : `No. ${issueNumber}`);
  }
  if (season && year) parts.push(`${season} ${year}`);
  else if (season) parts.push(season);
  else if (year) parts.push(year);

  return parts.join(", ");
}

export function normalizeIssueYear(input: unknown): number | null {
  const raw = clean(input);
  if (!raw) return null;
  const year = Number(raw);
  if (!Number.isFinite(year) || year < 0) return null;
  return Math.floor(year);
}

function cleanPublicationName(input: string): string {
  return input.replace(/[,:-]\s*$/, "").replace(/\s+/g, " ").trim();
}

export function parseMagazineTitle(rawTitle: string): ParsedMagazineTitle {
  const raw = clean(rawTitle);
  if (!raw) {
    return {
      publicationName: "",
      issueNumber: null,
      issueVolume: null,
      issueSeason: null,
      issueYear: null,
      flagged: true
    };
  }

  const seasonMatch = raw.match(/\b(Spring|Summer|Fall|Autumn|Winter|January|February|March|April|May|June|July|August|September|October|November|December)\b/i);
  const yearMatch = raw.match(/\b(19|20)\d{2}\b/);
  const volumeMatch = raw.match(/\bVol(?:ume)?\.?\s*([A-Za-z0-9]+)/i);
  const issueMatch = raw.match(/\b(?:Issue|No\.?|#)\s*([A-Za-z0-9-]+)/i);

  let publicationName = raw;
  let issueVolume: string | null = volumeMatch ? clean(volumeMatch[1]) : null;
  let issueNumber: string | null = issueMatch ? clean(issueMatch[1]) : null;
  const issueSeason = seasonMatch ? clean(seasonMatch[1]) : null;
  const issueYear = yearMatch ? Number(yearMatch[0]) : null;
  let flagged = false;

  if (raw.includes(":")) {
    const [left, right] = raw.split(/:\s*/, 2);
    publicationName = cleanPublicationName(left);
    if (!issueVolume) {
      const rightVolume = right.match(/\bVol(?:ume)?\.?\s*([A-Za-z0-9]+)/i);
      if (rightVolume) issueVolume = clean(rightVolume[1]);
    }
    if (!issueNumber) {
      const rightIssue = right.match(/\b(?:Issue|No\.?|#)\s*([A-Za-z0-9-]+)/i);
      if (rightIssue) issueNumber = clean(rightIssue[1]);
    }
  }

  if (!volumeMatch && !issueMatch) {
    const trailing = raw.match(/^(.*?)[\s,]+([IVXLCM]+|\d{1,4}|[A-Za-z]\d+)\s*$/i);
    if (trailing) {
      publicationName = cleanPublicationName(trailing[1] ?? "");
      issueNumber = issueNumber ?? clean(trailing[2] ?? "");
      flagged = true;
    }
  }

  if (volumeMatch) {
    publicationName = cleanPublicationName(raw.replace(volumeMatch[0], ""));
  }
  if (issueMatch) {
    publicationName = cleanPublicationName(publicationName.replace(issueMatch[0], ""));
  }
  if (seasonMatch) {
    publicationName = cleanPublicationName(publicationName.replace(seasonMatch[0], ""));
  }
  if (yearMatch) {
    publicationName = cleanPublicationName(publicationName.replace(yearMatch[0], ""));
  }

  if (!publicationName) publicationName = raw;
  if (!volumeMatch && !issueMatch && !raw.includes(":")) flagged = true;

  return {
    publicationName,
    issueNumber,
    issueVolume,
    issueSeason,
    issueYear,
    flagged
  };
}
