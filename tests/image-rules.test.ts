// modified-2026-09-16
import { describe, it, expect } from "vitest";
import {
  classifyImage,
  calculateSavings,
  estimateSavings,
  IMAGE_THRESHOLDS,
} from "../app/utils/image-rules";

describe("Image Classification Rules", () => {
  it("returns PENDING if file size is not known (null/undefined)", () => {
    expect(
      classifyImage({
        originalBytes: null,
        format: "jpeg",
        width: 1000,
        height: 1000,
      })
    ).toBe("PENDING");

    expect(
      classifyImage({
        originalBytes: undefined,
        format: "png",
        width: 500,
        height: 500,
      })
    ).toBe("PENDING");
  });

  it("classifies BMP and TIFF formats as HIGH_PRIORITY regardless of size", () => {
    expect(
      classifyImage({
        originalBytes: 100_000, // Small (100 KB)
        format: "bmp",
        width: 800,
        height: 600,
      })
    ).toBe("HIGH_PRIORITY");

    expect(
      classifyImage({
        originalBytes: 200_000,
        format: "tiff",
        width: 800,
        height: 600,
      })
    ).toBe("HIGH_PRIORITY");
  });

  it("classifies large images (> 1.5 MB) as HIGH_PRIORITY", () => {
    expect(
      classifyImage({
        originalBytes: 1_800_000, // 1.8 MB
        format: "jpeg",
        width: 1500,
        height: 1500,
      })
    ).toBe("HIGH_PRIORITY");
  });

  it("classifies large dimensions (> 3000px) on JPEG/PNG as HIGH_PRIORITY", () => {
    expect(
      classifyImage({
        originalBytes: 800_000, // 800 KB
        format: "jpeg",
        width: 3840,
        height: 2160,
      })
    ).toBe("HIGH_PRIORITY");
  });

  it("classifies images between 500 KB and 1.5 MB on JPEG/PNG as OPTIMIZATION_RECOMMENDED", () => {
    expect(
      classifyImage({
        originalBytes: 750_000, // 750 KB
        format: "png",
        width: 1200,
        height: 1200,
      })
    ).toBe("OPTIMIZATION_RECOMMENDED");
  });

  it("classifies dimensions > 2000px on JPEG/PNG as OPTIMIZATION_RECOMMENDED", () => {
    expect(
      classifyImage({
        originalBytes: 400_000, // 400 KB
        format: "jpeg",
        width: 2400,
        height: 1600,
      })
    ).toBe("OPTIMIZATION_RECOMMENDED");
  });

  it("classifies small WebP and AVIF images (<= 500 KB) as OPTIMIZED", () => {
    expect(
      classifyImage({
        originalBytes: 150_000, // 150 KB
        format: "webp",
        width: 1200,
        height: 800,
      })
    ).toBe("OPTIMIZED");

    expect(
      classifyImage({
        originalBytes: 250_000, // 250 KB
        format: "avif",
        width: 1200,
        height: 800,
      })
    ).toBe("OPTIMIZED");
  });

  it("classifies very large WebP images (> 500 KB) as OPTIMIZATION_RECOMMENDED for re-encoding", () => {
    expect(
      classifyImage({
        originalBytes: 900_000, // 900 KB
        format: "webp",
        width: 2000,
        height: 2000,
      })
    ).toBe("OPTIMIZATION_RECOMMENDED");
  });
});

describe("Savings Calculator", () => {
  it("calculates exact byte savings and reduction percentage", () => {
    const original = 1_800_000;
    const optimized = 620_000;
    const result = calculateSavings(original, optimized);

    expect(result.savedBytes).toBe(1_180_000);
    expect(result.improved).toBe(true);
    expect(result.reductionPercent).toBeCloseTo(65.56, 1);
  });

  it("guards against negative savings if optimized >= original", () => {
    const original = 50_000;
    const optimized = 55_000; // Larger than original
    const result = calculateSavings(original, optimized);

    expect(result.savedBytes).toBe(0);
    expect(result.reductionPercent).toBe(0);
    expect(result.improved).toBe(false);
  });

  it("handles equal file sizes gracefully", () => {
    const original = 100_000;
    const optimized = 100_000;
    const result = calculateSavings(original, optimized);

    expect(result.savedBytes).toBe(0);
    expect(result.reductionPercent).toBe(0);
    expect(result.improved).toBe(false);
  });
});

describe("Estimated Savings", () => {
  it("estimates 30% reduction for JPEG/PNG", () => {
    const { estimatedBytes, estimatedReductionPercent } = estimateSavings(
      1_000_000,
      "jpeg"
    );
    expect(estimatedReductionPercent).toBe(30);
    expect(estimatedBytes).toBe(700_000);
  });

  it("estimates 55% reduction for BMP/TIFF", () => {
    const { estimatedBytes, estimatedReductionPercent } = estimateSavings(
      1_000_000,
      "bmp"
    );
    expect(estimatedReductionPercent).toBe(55);
    expect(estimatedBytes).toBe(450_000);
  });
});
