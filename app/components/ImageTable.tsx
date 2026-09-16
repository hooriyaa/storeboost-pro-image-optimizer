// modified-2026-09-16
import React from "react";
import {
  IndexTable,
  Card,
  Text,
  Button,
  InlineStack,
  Thumbnail,
  Pagination,
  EmptySearchResult,
  Box,
  useIndexResourceState,
} from "@shopify/polaris";
import { formatBytes, formatDimensions, formatImageFormat, formatPercent } from "../utils/format";
import { StatusBadge } from "./StatusBadge";
import { estimateSavings } from "../utils/image-rules";

export interface ImageRecord {
  id: string;
  shopifyImageId: string;
  shopifyProductId: string;
  productTitle: string;
  originalUrl: string;
  width: number | null;
  height: number | null;
  format: string | null;
  originalBytes: number | null;
  optimizationStatus: string;
  optimizationResult: {
    originalBytes: number;
    optimizedBytes: number;
    savingsBytes: number;
    reductionPercent: number;
    outputFormat: string;
  } | null;
  [key: string]: unknown;
}

interface ImageTableProps {
  images: ImageRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  onOptimizeSingle: (id: string) => void;
  onOptimizeBulk: (ids: string[]) => void;
  onViewResult: (image: ImageRecord) => void;
  loading: boolean;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
}

export const ImageTable: React.FC<ImageTableProps> = ({
  images,
  total,
  page,
  limit,
  totalPages,
  onPageChange,
  onOptimizeSingle,
  onOptimizeBulk,
  onViewResult,
  loading,
  selectedIds,
  onSelectionChange,
}) => {
  const safeImages = Array.isArray(images) ? images : [];

  const resourceName = {
    singular: "image",
    plural: "images",
  };

  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } =
    useIndexResourceState(safeImages);

  // Sync selection back up
  React.useEffect(() => {
    onSelectionChange(selectedResources);
  }, [selectedResources, onSelectionChange]);

  const rowMarkup = safeImages.map((image, index) => {
    const isSelected = selectedResources.includes(image.id);
    const isOptimized = image.optimizationStatus === "COMPLETED";
    const isProcessing = image.optimizationStatus === "PROCESSING" || image.optimizationStatus === "QUEUED";

    let displayOptimizedSize = "—";
    let displaySavings = "—";

    if (image.optimizationResult) {
      displayOptimizedSize = formatBytes(image.optimizationResult.optimizedBytes);
      displaySavings = `${formatBytes(image.optimizationResult.savingsBytes)} (-${formatPercent(image.optimizationResult.reductionPercent)})`;
    } else if (image.originalBytes) {
      const { estimatedBytes, estimatedReductionPercent } = estimateSavings(
        image.originalBytes,
        image.format
      );
      displayOptimizedSize = `~${formatBytes(estimatedBytes)} (Est.)`;
      displaySavings = `~${formatBytes(image.originalBytes - estimatedBytes)} (-${estimatedReductionPercent}% Est.)`;
    }

    return (
      <IndexTable.Row
        id={image.id}
        key={image.id}
        selected={isSelected}
        position={index}
      >
        <IndexTable.Cell>
          <Thumbnail
            source={image.originalUrl}
            alt={image.productTitle}
            size="small"
          />
        </IndexTable.Cell>

        <IndexTable.Cell>
          <Text as="span" variant="bodyMd" fontWeight="bold">
            {image.productTitle}
          </Text>
        </IndexTable.Cell>

        <IndexTable.Cell>
          {formatBytes(image.originalBytes)}
        </IndexTable.Cell>

        <IndexTable.Cell>
          {formatDimensions(image.width, image.height)}
        </IndexTable.Cell>

        <IndexTable.Cell>
          {formatImageFormat(image.format)}
        </IndexTable.Cell>

        <IndexTable.Cell>
          <Text as="span" tone={isOptimized ? "success" : "subdued"}>
            {displayOptimizedSize}
          </Text>
        </IndexTable.Cell>

        <IndexTable.Cell>
          <Text as="span" tone={isOptimized ? "success" : "subdued"}>
            {displaySavings}
          </Text>
        </IndexTable.Cell>

        <IndexTable.Cell>
          <StatusBadge status={image.optimizationStatus} />
        </IndexTable.Cell>

        <IndexTable.Cell>
          <InlineStack gap="200">
            {isOptimized ? (
              <Button size="slim" onClick={() => onViewResult(image)}>
                View Results
              </Button>
            ) : (
              <Button
                size="slim"
                variant="primary"
                loading={isProcessing}
                disabled={isProcessing}
                onClick={() => onOptimizeSingle(image.id)}
              >
                {isProcessing ? "Processing..." : "Optimize Image"}
              </Button>
            )}
          </InlineStack>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  const emptyStateMarkup = (
    <EmptySearchResult
      title="No product images found"
      description="Click 'Scan Store' above to scan product images from your Shopify catalog."
      withIllustration
    />
  );

  return (
    <Card padding="0">
      {selectedResources.length > 0 && (
        <Box padding="300" background="bg-surface-secondary">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="span" variant="bodySm" fontWeight="semibold">
              {selectedResources.length} image{selectedResources.length > 1 ? "s" : ""} selected
            </Text>
            <InlineStack gap="200">
              <Button size="slim" onClick={clearSelection}>
                Cancel
              </Button>
              <Button
                size="slim"
                variant="primary"
                onClick={() => onOptimizeBulk(selectedResources)}
              >
                {`Optimize Selected (${selectedResources.length})`}
              </Button>
            </InlineStack>
          </InlineStack>
        </Box>
      )}

      <IndexTable
        resourceName={resourceName}
        itemCount={total}
        selectedItemsCount={
          (allResourcesSelected ? "All" : selectedResources.length) as any
        }
        onSelectionChange={handleSelectionChange}
        headings={[
          { title: "Thumbnail" },
          { title: "Product" },
          { title: "Original Size" },
          { title: "Dimensions" },
          { title: "Format" },
          { title: "Optimized Size" },
          { title: "Savings" },
          { title: "Status" },
          { title: "Actions" },
        ]}
        emptyState={emptyStateMarkup}
        loading={loading}
      >
        {rowMarkup}
      </IndexTable>

      {totalPages > 1 && (
        <Box padding="400">
          <InlineStack align="center">
            <Pagination
              hasPrevious={page > 1}
              onPrevious={() => onPageChange(page - 1)}
              hasNext={page < totalPages}
              onNext={() => onPageChange(page + 1)}
              label={`Page ${page} of ${totalPages}`}
            />
          </InlineStack>
        </Box>
      )}
    </Card>
  );
};
