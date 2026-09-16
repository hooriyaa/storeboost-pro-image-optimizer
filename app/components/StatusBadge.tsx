// modified-2026-09-16
import React from "react";
import { Badge } from "@shopify/polaris";
import type { OptimizationStatus } from "@prisma/client";

interface StatusBadgeProps {
  status: OptimizationStatus | string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  switch (status) {
    case "HIGH_PRIORITY":
      return <Badge tone="critical">High Priority</Badge>;
    case "OPTIMIZATION_RECOMMENDED":
      return <Badge tone="warning">Optimization Recommended</Badge>;
    case "OPTIMIZED":
      return <Badge tone="success">Optimized</Badge>;
    case "QUEUED":
      return <Badge tone="info">Queued</Badge>;
    case "PROCESSING":
      return <Badge tone="attention">Processing</Badge>;
    case "COMPLETED":
      return <Badge tone="success">Completed</Badge>;
    case "FAILED":
      return <Badge tone="critical">Failed</Badge>;
    case "PENDING":
    default:
      return <Badge>Pending Analysis</Badge>;
  }
};
