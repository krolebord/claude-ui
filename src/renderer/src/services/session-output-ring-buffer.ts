export const SESSION_OUTPUT_MAX_LINES = 10_000;
export const SESSION_OUTPUT_MAX_BYTES = 2 * 1024 * 1024;
const SESSION_OUTPUT_COMPACT_THRESHOLD = 1_024;

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

interface BufferedOutputLine {
  text: string;
  byteLength: number;
  charLength: number;
}

function getUtf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).length;
}

function trimToUtf8ByteSuffix(value: string, maxBytes: number): string {
  if (maxBytes <= 0 || !value) {
    return "";
  }

  const encoded = UTF8_ENCODER.encode(value);
  if (encoded.length <= maxBytes) {
    return value;
  }

  let start = encoded.length - maxBytes;

  while (
    start < encoded.length &&
    (encoded[start] & 0b1100_0000) === 0b1000_0000
  ) {
    start += 1;
  }

  return UTF8_DECODER.decode(encoded.subarray(start));
}

export class SessionOutputRingBuffer {
  private readonly maxLines: number;
  private readonly maxBytes: number;
  private readonly lines: BufferedOutputLine[] = [];
  private firstLineIndex = 0;
  private trailingFragment = "";
  private trailingFragmentBytes = 0;
  private trailingFragmentChars = 0;
  private totalBytes = 0;
  private totalChars = 0;

  constructor(maxLines: number, maxBytes: number) {
    this.maxLines = maxLines;
    this.maxBytes = maxBytes;
  }

  append(chunk: string): void {
    if (!chunk) {
      return;
    }

    const combined = this.trailingFragment + chunk;
    this.clearTrailingFragment();

    const segments = combined.split("\n");
    const nextTrailingFragment = segments.pop() ?? "";

    for (const segment of segments) {
      const lineText = `${segment}\n`;
      const byteLength = getUtf8ByteLength(lineText);
      const charLength = lineText.length;
      this.lines.push({
        text: lineText,
        byteLength,
        charLength,
      });
      this.totalBytes += byteLength;
      this.totalChars += charLength;
    }

    this.setTrailingFragment(nextTrailingFragment);
    this.evictByLineLimit();
    this.evictByByteLimit();
  }

  getCharLength(): number {
    return this.totalChars;
  }

  toString(): string {
    const visibleLines = this.lines.slice(this.firstLineIndex);
    if (visibleLines.length === 0) {
      return this.trailingFragment;
    }

    return (
      visibleLines.map((line) => line.text).join("") + this.trailingFragment
    );
  }

  private getLineCount(): number {
    return this.lines.length - this.firstLineIndex;
  }

  private clearTrailingFragment(): void {
    this.totalBytes -= this.trailingFragmentBytes;
    this.totalChars -= this.trailingFragmentChars;
    this.trailingFragment = "";
    this.trailingFragmentBytes = 0;
    this.trailingFragmentChars = 0;
  }

  private setTrailingFragment(value: string): void {
    this.trailingFragment = value;
    this.trailingFragmentBytes = getUtf8ByteLength(value);
    this.trailingFragmentChars = value.length;
    this.totalBytes += this.trailingFragmentBytes;
    this.totalChars += this.trailingFragmentChars;
  }

  private removeOldestLine(): void {
    if (this.getLineCount() <= 0) {
      return;
    }

    const oldest = this.lines[this.firstLineIndex];
    this.firstLineIndex += 1;
    this.totalBytes -= oldest.byteLength;
    this.totalChars -= oldest.charLength;
    this.compactLinesIfNeeded();
  }

  private compactLinesIfNeeded(): void {
    if (
      this.firstLineIndex >= SESSION_OUTPUT_COMPACT_THRESHOLD &&
      this.firstLineIndex * 2 >= this.lines.length
    ) {
      this.lines.splice(0, this.firstLineIndex);
      this.firstLineIndex = 0;
    }
  }

  private evictByLineLimit(): void {
    while (this.getLineCount() > this.maxLines) {
      this.removeOldestLine();
    }
  }

  private evictByByteLimit(): void {
    while (this.totalBytes > this.maxBytes && this.getLineCount() > 0) {
      this.removeOldestLine();
    }

    if (this.totalBytes <= this.maxBytes || this.getLineCount() > 0) {
      return;
    }

    const trimmedFragment = trimToUtf8ByteSuffix(
      this.trailingFragment,
      this.maxBytes,
    );
    this.clearTrailingFragment();
    this.setTrailingFragment(trimmedFragment);
  }
}
