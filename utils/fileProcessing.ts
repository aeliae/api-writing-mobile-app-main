const CHUNK_SIZE = 6000;
const CHUNK_OVERLAP = 500;
const MAX_SUMMARY_CHARS = 400;

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'it', 'its', 'this',
  'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they', 'me',
  'him', 'her', 'us', 'them', 'my', 'your', 'his', 'our', 'their', 'what',
  'which', 'who', 'whom', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'not', 'only', 'same', 'so', 'than', 'too', 'very', 'just', 'as', 'if',
  'then', 'because', 'while', 'although', 'though', 'since', 'after',
  'before', 'about', 'above', 'below', 'between', 'into', 'through',
  'during', 'without', 'within', 'along', 'following', 'across', 'behind',
  'also', 'however', 'therefore', 'thus', 'hence', 'still', 'yet',
]);

export function normalizeFileText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove null bytes and control characters that aren't whitespace
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Collapse more than 3 consecutive blank lines to 2
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

export interface RawChunk {
  title?: string;
  content: string;
  summary?: string;
  keywords?: string[];
}

export function chunkText(text: string): RawChunk[] {
  const normalized = normalizeFileText(text);

  if (normalized.length <= CHUNK_SIZE) {
    const kw = extractKeywords(normalized);
    return [{
      title: extractFirstHeading(normalized) || undefined,
      content: normalized,
      summary: createLocalSummary(normalized),
      keywords: kw,
    }];
  }

  const chunks: RawChunk[] = [];
  let start = 0;

  while (start < normalized.length) {
    const end = findChunkEnd(normalized, start, CHUNK_SIZE);
    const chunkContent = normalized.slice(start, end).trim();

    if (chunkContent.length > 0) {
      const title = extractFirstHeading(chunkContent);
      chunks.push({
        title: title || `Part ${chunks.length + 1}`,
        content: chunkContent,
        summary: createLocalSummary(chunkContent, 200),
        keywords: extractKeywords(chunkContent),
      });
    }

    // Advance with overlap — go back CHUNK_OVERLAP chars from end
    const nextStart = end - CHUNK_OVERLAP;
    if (nextStart <= start) {
      // Safety: avoid infinite loop on very long lines with no break points
      start = end;
    } else {
      start = nextStart;
    }
  }

  return chunks;
}

function findChunkEnd(text: string, start: number, size: number): number {
  const idealEnd = start + size;
  if (idealEnd >= text.length) return text.length;

  // Try to break on a heading (## or # at start of line)
  const headingBreak = findLastBreakOn(text, start + Math.floor(size * 0.6), idealEnd, /\n#{1,3} /);
  if (headingBreak !== -1) return headingBreak;

  // Try to break on a double blank line (paragraph boundary)
  const paraBreak = findLastBreakOn(text, start + Math.floor(size * 0.6), idealEnd, /\n\n/);
  if (paraBreak !== -1) return paraBreak;

  // Try single blank line
  const lineBreak = findLastBreakOn(text, start + Math.floor(size * 0.7), idealEnd, /\n/);
  if (lineBreak !== -1) return lineBreak;

  // Try sentence boundary
  const sentenceBreak = findLastBreakOn(text, start + Math.floor(size * 0.7), idealEnd, /[.!?] /);
  if (sentenceBreak !== -1) return sentenceBreak + 2; // include the punctuation and space

  return idealEnd;
}

function findLastBreakOn(text: string, rangeStart: number, rangeEnd: number, pattern: RegExp): number {
  const slice = text.slice(rangeStart, rangeEnd);
  const matches = [...slice.matchAll(new RegExp(pattern, 'g'))];
  if (matches.length === 0) return -1;
  const last = matches[matches.length - 1];
  return rangeStart + (last.index ?? 0);
}

function extractFirstHeading(text: string): string | null {
  const match = text.match(/^#{1,3}\s+(.+)/m);
  if (match) return match[1].trim();
  // Also try plain first line if it's short and looks like a title
  const firstLine = text.split('\n')[0].trim();
  if (firstLine.length > 0 && firstLine.length < 80 && !firstLine.includes('.')) {
    return firstLine;
  }
  return null;
}

export function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));

  const freq: Record<string, number> = {};
  for (const word of words) {
    freq[word] = (freq[word] || 0) + 1;
  }

  return Object.entries(freq)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word]) => word);
}

export function createLocalSummary(text: string, maxChars: number = MAX_SUMMARY_CHARS): string {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return '';

  const parts: string[] = [];
  let charCount = 0;

  // Collect headings first
  const headings = lines.filter(l => /^#{1,3}\s/.test(l)).slice(0, 5);
  for (const h of headings) {
    const clean = h.replace(/^#+\s*/, '').trim();
    if (charCount + clean.length + 2 <= maxChars) {
      parts.push(clean);
      charCount += clean.length + 2;
    }
  }

  // Add first non-heading paragraph if we have room
  const firstPara = lines.find(l => !/^#{1,3}\s/.test(l) && l.length > 30);
  if (firstPara && charCount < maxChars) {
    const available = maxChars - charCount;
    const snippet = firstPara.length > available ? firstPara.slice(0, available - 3) + '...' : firstPara;
    parts.push(snippet);
  }

  // If we have no headings or paragraphs yet, just take the start of the text
  if (parts.length === 0) {
    return text.slice(0, maxChars).trimEnd() + (text.length > maxChars ? '...' : '');
  }

  return parts.join(' | ');
}
