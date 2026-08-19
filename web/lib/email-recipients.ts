/** One parsed invite target: an address plus an optional display name. */
export interface EmailRecipient {
  email: string;
  /** Display name when the entry used the `Name <email>` form. */
  name: string | null;
}

const ANGLE_ENTRY = /^(.*?)<\s*([^<>]+?)\s*>$/;
const BARE_EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

function stripWrappingQuotes(value: string): string {
  const trimmed: string = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first: string = trimmed[0] ?? "";
  const last: string = trimmed[trimmed.length - 1] ?? "";
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Split a free-text recipient list into entries.
 *
 * Commas, semicolons and newlines always separate. Spaces separate too, but
 * only outside `<>` and quotes, so `Teg Grenager <teg@example.com>` survives
 * as a single entry.
 */
function splitEntries(input: string): string[] {
  const entries: string[] = [];
  let current: string = "";
  let inAngle: boolean = false;
  let closedAngle: boolean = false;
  let quote: '"' | "'" | null = null;

  function flush(): void {
    if (current.trim() !== "") entries.push(current.trim());
    current = "";
    closedAngle = false;
  }

  for (const char of input) {
    if (quote !== null) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "<") {
      inAngle = true;
      current += char;
      continue;
    }
    if (char === ">") {
      inAngle = false;
      closedAngle = true;
      current += char;
      continue;
    }
    const isSeparator: boolean =
      char === "," || char === ";" || char === "\n" || char === "\r";
    if (isSeparator || (!inAngle && /\s/.test(char))) {
      // A bare space ends the entry only once it holds a complete address,
      // otherwise the space belongs to a display name like "Teg Grenager".
      if (isSeparator || closedAngle || BARE_EMAIL.test(current.trim())) {
        flush();
        continue;
      }
      current += char;
      continue;
    }
    current += char;
  }
  flush();
  return entries;
}

function parseEntry(entry: string): EmailRecipient | null {
  const angle = ANGLE_ENTRY.exec(entry);
  if (angle !== null) {
    const email: string = (angle[2] ?? "").trim().toLowerCase();
    if (!BARE_EMAIL.test(email)) return null;
    const name: string = stripWrappingQuotes(angle[1] ?? "");
    return { email, name: name === "" ? null : name };
  }
  const bare: string = stripWrappingQuotes(entry).toLowerCase();
  if (!BARE_EMAIL.test(bare)) return null;
  return { email: bare, name: null };
}

/**
 * Parse a pasted recipient list, tolerating comma-, semicolon-, newline- and
 * space-separated entries in either `email` or `Name <email>` form.
 * Duplicate addresses collapse, preferring the entry that carried a name.
 */
export function parseEmailRecipients(input: string): EmailRecipient[] {
  const byEmail = new Map<string, EmailRecipient>();
  for (const entry of splitEntries(input)) {
    const parsed: EmailRecipient | null = parseEntry(entry);
    if (parsed === null) continue;
    const existing: EmailRecipient | undefined = byEmail.get(parsed.email);
    if (existing === undefined || (existing.name === null && parsed.name !== null)) {
      byEmail.set(parsed.email, parsed);
    }
  }
  return [...byEmail.values()];
}

/** Text that could not be parsed into an address, for inline validation. */
export function invalidEmailEntries(input: string): string[] {
  return splitEntries(input).filter((entry) => parseEntry(entry) === null);
}
