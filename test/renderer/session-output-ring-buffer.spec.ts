import { describe, expect, it } from "vitest";
import { SessionOutputRingBuffer } from "../../src/renderer/src/services/session-output-ring-buffer";

describe("SessionOutputRingBuffer", () => {
  it("retains only the newest lines up to the configured line limit", () => {
    const buffer = new SessionOutputRingBuffer(3, 1_000);

    buffer.append("line-1\nline-2\nline-3\nline-4\n");

    expect(buffer.toString()).toBe("line-2\nline-3\nline-4\n");
  });

  it("retains only the byte suffix when a trailing fragment exceeds max bytes", () => {
    const maxBytes = 5;
    const buffer = new SessionOutputRingBuffer(100, maxBytes);

    buffer.append("abcdefg");

    const output = buffer.toString();
    expect(output).toBe("cdefg");
    expect(new TextEncoder().encode(output).length).toBeLessThanOrEqual(maxBytes);
  });

  it("tracks rendered character length", () => {
    const buffer = new SessionOutputRingBuffer(100, 1_000);

    buffer.append("abc\n");
    buffer.append("de");

    expect(buffer.getCharLength()).toBe(6);
    expect(buffer.toString()).toBe("abc\nde");
  });
});
