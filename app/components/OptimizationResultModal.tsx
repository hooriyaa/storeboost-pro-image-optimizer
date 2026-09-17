// modified-2026-09-17
import React, { useState } from "react";
import {
  Modal,
  BlockStack,
  Text,
  InlineStack,
  Box,
  Divider,
  Badge,
  Thumbnail,
} from "@shopify/polaris";
import { formatBytes, formatPercent } from "../utils/format";

export interface OptimizationResultData {
  imageId?: string;
  productTitle: string;
  originalUrl: string;
  format: string;
  originalBytes: number;
  optimizedBytes: number;
  savingsBytes: number;
  reductionPercent: number;
  outputFormat: string;
}

interface OptimizationResultModalProps {
  open: boolean;
  onClose: () => void;
  result: OptimizationResultData | null;
}

export const OptimizationResultModal: React.FC<OptimizationResultModalProps> = ({
  open,
  onClose,
  result,
}) => {
  const [downloading, setDownloading] = useState(false);

  if (!result) return null;

  const hasImageId = Boolean(result.imageId);

  const handleDownload = async () => {
    if (!result?.imageId || downloading) return;
    setDownloading(true);
    try {
      const response = await fetch(`/api/images/${result.imageId}/download`);
      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.statusText}`);
      }
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      const safeName = result.productTitle.replace(/[^a-zA-Z0-9_-]/g, "_");
      link.download = `${safeName || "image"}_optimized.webp`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("Download failed:", error);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Optimization Results & Preview"
      primaryAction={{
        content: "Close",
        onAction: onClose,
      }}
      secondaryActions={
        hasImageId
          ? [
              {
                content: downloading ? "Downloading..." : "Download Optimized WebP",
                onAction: handleDownload,
                loading: downloading,
              },
            ]
          : undefined
      }
    >
      <Modal.Section>
        <BlockStack gap="400">
          <InlineStack gap="300" blockAlign="center">
            {result.originalUrl && (
              <Thumbnail
                source={result.originalUrl}
                alt={result.productTitle}
                size="medium"
              />
            )}
            <BlockStack gap="100">
              <Text as="h3" variant="headingMd" fontWeight="bold">
                {result.productTitle}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Processed via Sharp Image Engine (Quality 82 WebP Transcode)
              </Text>
            </BlockStack>
          </InlineStack>

          <Box padding="400" background="bg-surface-secondary" borderRadius="200">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">
                  Original Format / Size
                </Text>
                <Text as="p" variant="headingMd" fontWeight="semibold">
                  {result.format.toUpperCase()} • {formatBytes(result.originalBytes)}
                </Text>
              </BlockStack>

              <Text as="span" variant="headingLg" tone="subdued">
                →
              </Text>

              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">
                  Optimized Format / Size
                </Text>
                <InlineStack gap="200" blockAlign="center">
                  <Text as="p" variant="headingMd" fontWeight="semibold" tone="success">
                    {result.outputFormat.toUpperCase()} • {formatBytes(result.optimizedBytes)}
                  </Text>
                  <Badge tone="success">{`-${formatPercent(result.reductionPercent)}`}</Badge>
                </InlineStack>
              </BlockStack>
            </InlineStack>
          </Box>

          <Divider />

          <InlineStack align="space-between" blockAlign="center">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Actual Space Saved:
            </Text>
            <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
              {formatBytes(result.savingsBytes)} ({formatPercent(result.reductionPercent)} reduction)
            </Text>
          </InlineStack>

          {hasImageId && (
            <Box padding="300" background="bg-surface-secondary" borderRadius="150">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="050">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    Verify & inspect the generated WebP:
                  </Text>
                  <Text as="p" variant="bodyXs" tone="subdued">
                    Download the exact image file generated by Sharp.
                  </Text>
                </BlockStack>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="nex-download-btn"
                  disabled={downloading}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span>{downloading ? "Downloading..." : "Download Optimized WebP"}</span>
                </button>
              </InlineStack>
            </Box>
          )}

          <Box padding="300" background="bg-surface-warning" borderRadius="150">
            <Text as="p" variant="bodyXs" tone="subdued">
              Note: Assessment implementation keeps the original live Shopify image untouched and stores the optimized WebP version separately for verification and preview.
            </Text>
          </Box>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
};

