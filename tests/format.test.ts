// modified-2026-09-16
import { describe, it, expect } from "vitest";
import { formatBytes, formatDimensions, formatPercent, clampPercent } from "../app/utils/format";

describe("Format Utilities", () => {
  it("formats bytes accurately", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(620 * 1024)).toBe("620.0 KB");
    expect(formatBytes(1.8 * 1024 * 1024)).toBe("1.80 MB");
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.50 GB");
    expect(formatBytes(null)).toBe("Unknown");
    expect(formatBytes(undefined)).toBe("Unknown");
  });

  it("formats percentages accurately", () => {
    expect(formatPercent(65.555)).toBe("65.6%");
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatPercent(100)).toBe("100.0%");
    expect(formatPercent(null)).toBe("N/A");
  });

  it("formats image dimensions accurately", () => {
    expect(formatDimensions(2400, 1600)).toBe("2400 × 1600");
    expect(formatDimensions(null, 1600)).toBe("Unknown");
    expect(formatDimensions(2400, null)).toBe("Unknown");
  });

  it("clamps percentages between 0 and 100", () => {
    expect(clampPercent(-10)).toBe(0);
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(45.5)).toBe(45.5);
  });
});
