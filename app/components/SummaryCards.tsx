// modified-2026-09-16
import React from "react";
import { Grid, Card, BlockStack, Text, ProgressBar, Box, InlineStack } from "@shopify/polaris";
import { formatBytes, formatCount, formatPercent } from "../utils/format";

interface StatsProps {
  stats: {
    totalImages: number;
    needsOptimization: number;
    highPriority: number;
    recommended: number;
    completed: number;
    failed: number;
    potentialSavingsBytes: number;
    actualSavingsBytes: number;
    estimatedSavingsBytes: number;
    progressPercent: number;
  };
}

export const SummaryCards: React.FC<StatsProps> = ({ stats }) => {
  const safeStats = stats || {
    totalImages: 0,
    needsOptimization: 0,
    highPriority: 0,
    recommended: 0,
    completed: 0,
    failed: 0,
    potentialSavingsBytes: 0,
    actualSavingsBytes: 0,
    estimatedSavingsBytes: 0,
    progressPercent: 0,
  };

  const totalImages = safeStats.totalImages ?? 0;
  const needsOptimization = safeStats.needsOptimization ?? 0;
  const highPriority = safeStats.highPriority ?? 0;
  const recommended = safeStats.recommended ?? 0;
  const actualSavings = safeStats.actualSavingsBytes ?? 0;
  const potentialSavings = safeStats.potentialSavingsBytes ?? 0;
  const progressPercent = safeStats.progressPercent ?? 0;

  return (
    <Grid>
      <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm" tone="subdued">
              Images Scanned
            </Text>
            <Text as="p" variant="heading2xl" fontWeight="bold">
              {formatCount(totalImages)}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Total product images discovered
            </Text>
          </BlockStack>
        </Card>
      </Grid.Cell>

      <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm" tone="subdued">
              Needs Optimization
            </Text>
            <InlineStack align="space-between" blockAlign="center">
              <Text as="p" variant="heading2xl" fontWeight="bold" tone={needsOptimization > 0 ? "critical" : "success"}>
                {formatCount(needsOptimization)}
              </Text>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              {highPriority} High Priority • {recommended} Recommended
            </Text>
          </BlockStack>
        </Card>
      </Grid.Cell>

      <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm" tone="subdued">
              Storage Savings
            </Text>
            <Text as="p" variant="heading2xl" fontWeight="bold">
              {formatBytes(actualSavings || potentialSavings)}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {actualSavings > 0
                ? `${formatBytes(actualSavings)} actual measured`
                : `${formatBytes(potentialSavings)} estimated potential`}
            </Text>
          </BlockStack>
        </Card>
      </Grid.Cell>

      <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm" tone="subdued">
              Optimization Progress
            </Text>
            <Text as="p" variant="heading2xl" fontWeight="bold">
              {formatPercent(progressPercent)}
            </Text>
            <Box paddingBlockStart="100">
              <ProgressBar progress={progressPercent} size="small" tone="primary" />
            </Box>
          </BlockStack>
        </Card>
      </Grid.Cell>
    </Grid>
  );
};
