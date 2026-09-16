// modified-2026-09-16
import React from "react";
import { Modal, BlockStack, Text, InlineStack, Box, Divider, Badge } from "@shopify/polaris";
import { formatBytes, formatPercent } from "../utils/format";

export interface OptimizationResultData {
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
  if (!result) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Optimization Results"
      primaryAction={{
        content: "Done",
        onAction: onClose,
      }}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text as="h3" variant="headingMd">
            {result.productTitle}
          </Text>

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

          <Box padding="300" background="bg-surface-warning" borderRadius="150">
            <Text as="p" variant="bodyXs" tone="subdued">
              Note: Assessment implementation keeps the original live Shopify image untouched and stores the optimized version separately for preview.
            </Text>
          </Box>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
};
