// modified-2026-09-16
import React from "react";
import { Banner, BlockStack, ProgressBar, Text, InlineStack, Spinner } from "@shopify/polaris";
import { formatCount } from "../utils/format";

interface ScanProgressProps {
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | string;
  scannedImages?: number | null;
  totalImages?: number | null;
  error?: string | null;
}

export const ScanProgress: React.FC<ScanProgressProps> = ({
  status,
  scannedImages = 0,
  totalImages,
  error,
}) => {
  if (status === "FAILED") {
    return (
      <Banner title="Scan Failed" tone="critical">
        <p>{error || "An error occurred while scanning product images from your Shopify store."}</p>
      </Banner>
    );
  }

  if (status === "QUEUED" || status === "RUNNING") {
    const safeScanned = scannedImages ?? 0;
    const progress =
      totalImages && totalImages > 0
        ? Math.round((safeScanned / totalImages) * 100)
        : undefined;

    return (
      <Banner tone="info">
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="200" blockAlign="center">
              <Spinner size="small" />
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                Scanning store for product images...
              </Text>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              {formatCount(safeScanned)} images discovered
            </Text>
          </InlineStack>
          {progress !== undefined ? (
            <ProgressBar progress={progress} size="small" />
          ) : (
            <ProgressBar progress={undefined} size="small" />
          )}
        </BlockStack>
      </Banner>
    );
  }

  return null;
};
