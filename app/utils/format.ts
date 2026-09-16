// modified-2026-09-16
/**
 * Formatting utilities for the StoreBoost Pro dashboard.
 */

export function formatBytes(bytes: number | bigint | null | undefined): string {
  if (bytes === null || bytes === undefined) return "Unknown";
  const n = typeof bytes === "bigint" ? Number(bytes) : bytes;
  if (n === 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "N/A";
  return `${value.toFixed(1)}%`;
}

export function formatDimensions(
  width: number | null | undefined,
  height: number | null | undefined
): string {
  if (!width || !height) return "Unknown";
  return `${width} × ${height}`;
}

export function formatStatus(status: string): string {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function formatCount(count: number | null | undefined): string {
  if (count === null || count === undefined) return "0";
  return count.toLocaleString("en-US");
}

export function formatImageFormat(format: string | null | undefined): string {
  if (!format) return "Unknown";
  return format.toUpperCase();
}

export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}
