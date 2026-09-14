/**
 * Pull the article URL out of text shared from another app.
 *
 * A share sheet rarely hands over a bare link. It hands over a headline and a
 * link, or a link and a sign-off, sometimes wrapped in brackets or quotes and
 * split across lines. Pasted straight into the composer's link field that is
 * not a URL, so the preview never loads and the member is left to trim it by
 * hand.
 */

/** Characters that commonly bracket a pasted link, in matched pairs. */
const WRAPPERS: Record<string, string> = {
  "<": ">",
  "(": ")",
  "[": "]",
  "{": "}",
  '"': '"',
  "'": "'",
  "“": "”",
  "‘": "’",
};

/** Sentence punctuation that ends up glued to the end of a pasted link. */
const TRAILING_PUNCTUATION: ReadonlySet<string> = new Set([
  ".",
  ",",
  ";",
  ":",
  "!",
  "?",
  "…",
  "”",
  "’",
  '"',
  "'",
  ">",
  "]",
  "}",
]);

/** An http(s) link. Stops at whitespace; punctuation is trimmed after. */
const SCHEMED: RegExp = /https?:\/\/[^\s<>"']+/i;

/**
 * A link with the scheme left off, e.g. `www.example.com/x`. Requires a dot
 * and a letters-only ending so ordinary prose ("read this...done") cannot
 * masquerade as a host.
 */
const SCHEMELESS: RegExp =
  /\b(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,24}(?::\d{2,5})?(?:\/[^\s<>"']*)?/i;

/** Unbalanced closing brackets belong to the sentence, not the link. */
function unbalancedTail(url: string): number {
  for (const [open, close] of Object.entries(WRAPPERS)) {
    if (open === close) continue;
    if (!url.endsWith(close)) continue;
    const opens: number = url.split(open).length - 1;
    const closes: number = url.split(close).length - 1;
    // A Wikipedia link like /Foo_(disambiguation) keeps its bracket; a link
    // pasted inside a parenthetical does not.
    if (closes > opens) return 1;
  }
  return 0;
}

function trimEdges(raw: string): string {
  let url: string = raw;
  let trimming: boolean = true;
  while (trimming && url.length > 0) {
    trimming = false;
    const last: string = url.slice(-1);
    if (TRAILING_PUNCTUATION.has(last)) {
      // Only drop a bracket the link never opened.
      const isBracket: boolean = last === ">" || last === "]" || last === "}";
      if (!isBracket || unbalancedTail(url) > 0) {
        url = url.slice(0, -1);
        trimming = true;
        continue;
      }
    }
    if (unbalancedTail(url) > 0) {
      url = url.slice(0, -1);
      trimming = true;
    }
  }
  return url;
}

function stripWrappers(text: string): string {
  let inner: string = text.trim();
  let stripped: boolean = true;
  while (stripped && inner.length > 1) {
    stripped = false;
    const open: string = inner.slice(0, 1);
    const close: string | undefined = WRAPPERS[open];
    if (close !== undefined && inner.endsWith(close)) {
      inner = inner.slice(1, -1).trim();
      stripped = true;
    }
  }
  return inner;
}

/**
 * The URL inside `input`, or `input` unchanged when there is nothing to pull
 * out. Returns the input untouched for empty text and for text with no link,
 * so it is safe to call on every keystroke: someone typing a link by hand
 * only matches once they have typed a whole one, and the match is then the
 * text itself.
 *
 * With more than one link, the first wins — share text leads with the article
 * and trails with the app that sent it.
 */
export function extractUrlFromShareText(input: string): string {
  if (!input.trim()) return input;

  // Zero-width characters are deleted rather than turned into separators:
  // some apps inject them into a long link so it can wrap, and treating
  // one as a space cuts the URL in half at that point. The visible exotic
  // spaces (en, em, thin, non-breaking) really are separators, so those
  // collapse along with newlines and tabs.
  const flat: string = stripWrappers(
    input
      .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
      .replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, " ")
      .replace(/\s+/g, " "),
  );

  const schemed: RegExpMatchArray | null = flat.match(SCHEMED);
  if (schemed !== null) {
    const cleaned: string = trimEdges(schemed[0]);
    return cleaned || input;
  }

  const bare: RegExpMatchArray | null = flat.match(SCHEMELESS);
  if (bare !== null) {
    const cleaned: string = trimEdges(bare[0]);
    // Only rewrite a bare host into a link when it really looks like one;
    // "Dr. Smith" must not become https://dr.smith.
    if (cleaned.includes(".")) return `https://${cleaned}`;
  }

  return input;
}
