"use client";

import {
  BaseEdge,
  getSmoothStepPath,
  type EdgeProps
} from "@xyflow/react";
import { useMemo, useState } from "react";
import type { ModelingGraphRelationshipType } from "@text2sql/shared-types";
import { cn } from "@/lib/utils";

export const MODELING_FLOW_EDGE_TYPE = "modelingFlowEdge";

export type ModelingFlowEdgeData = {
  label: string;
  source: "manual" | "inferred" | "fk" | "semantic";
  confidence: number;
  type?: ModelingGraphRelationshipType;
  cardinality?: ModelingGraphRelationshipType;
  from?: {
    dataset: string;
    table: string;
    column: string;
  };
  to?: {
    dataset: string;
    table: string;
    column: string;
  };
  description?: string;
  invalid?: boolean;
};

function resolveEdgeRelationshipType(
  edgeData?: ModelingFlowEdgeData
): ModelingGraphRelationshipType | null {
  const relationshipType = edgeData?.type ?? edgeData?.cardinality;
  if (
    relationshipType === "many-to-one" ||
    relationshipType === "one-to-many" ||
    relationshipType === "one-to-one"
  ) {
    return relationshipType;
  }
  return null;
}

function resolveEndpointMarkers(relationshipType: ModelingGraphRelationshipType | null): {
  source: "one" | "many" | "none";
  target: "one" | "many" | "none";
} {
  if (relationshipType === "one-to-many") {
    return {
      source: "one",
      target: "many"
    };
  }
  if (relationshipType === "many-to-one") {
    return {
      source: "many",
      target: "one"
    };
  }
  if (relationshipType === "one-to-one") {
    return {
      source: "one",
      target: "one"
    };
  }
  return {
    source: "none",
    target: "none"
  };
}

function resolveRelationshipTypeLabel(relationshipType: ModelingGraphRelationshipType | null): string {
  if (relationshipType === "one-to-many") {
    return "One-to-many";
  }
  if (relationshipType === "many-to-one") {
    return "Many-to-one";
  }
  if (relationshipType === "one-to-one") {
    return "One-to-one";
  }
  return "Unknown";
}

function formatEndpointPath(
  endpoint: ModelingFlowEdgeData["from"] | ModelingFlowEdgeData["to"] | undefined
): string {
  if (!endpoint) {
    return "-";
  }
  return `${endpoint.dataset}.${endpoint.table}.${endpoint.column}`;
}

export function ModelingFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data
}: EdgeProps) {
  const edgeData = data as ModelingFlowEdgeData | undefined;
  const [hovered, setHovered] = useState(false);
  const confidence = edgeData?.confidence ?? 1;
  const relationshipType = resolveEdgeRelationshipType(edgeData);
  const markerType = resolveEndpointMarkers(relationshipType);
  const relationshipTypeLabel = resolveRelationshipTypeLabel(relationshipType);
  const isInvalid = Boolean(edgeData?.invalid);
  const isLowConfidence = !isInvalid && confidence < 0.6;
  const hasDash = !selected && (isInvalid || edgeData?.source === "inferred" || isLowConfidence);
  const confidenceBand = isInvalid ? "invalid" : isLowConfidence ? "low" : "normal";
  const fromPath = formatEndpointPath(edgeData?.from);
  const toPath = formatEndpointPath(edgeData?.to);
  const markerColor = isInvalid
    ? selected
      ? "#dc2626"
      : "#ef4444"
    : isLowConfidence
      ? "#d97706"
      : selected
        ? "var(--action-primary)"
        : "var(--border-strong)";
  const edgeMarkerIdPrefix = useMemo(
    () => `modeling-flow-edge-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
    [id]
  );
  const oneMarkerId = `${edgeMarkerIdPrefix}-one`;
  const manyMarkerId = `${edgeMarkerIdPrefix}-many`;
  const markerStart =
    markerType.source === "one"
      ? `url(#${oneMarkerId})`
      : markerType.source === "many"
        ? `url(#${manyMarkerId})`
        : undefined;
  const markerEnd =
    markerType.target === "one"
      ? `url(#${oneMarkerId})`
      : markerType.target === "many"
        ? `url(#${manyMarkerId})`
        : undefined;
  const shouldShowDetailCard = Boolean(edgeData && (hovered || selected));

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 10,
    offset: 14
  });

  return (
    <>
      <defs>
        <marker
          id={oneMarkerId}
          markerWidth="10"
          markerHeight="10"
          refX="5"
          refY="5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M5 1 L5 9" stroke={markerColor} strokeWidth="1.5" fill="none" />
        </marker>
        <marker
          id={manyMarkerId}
          markerWidth="10"
          markerHeight="10"
          refX="5"
          refY="5"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path
            d="M1.5 1.5 L8.5 5 L1.5 8.5 M1.5 5 L8.5 5"
            stroke={markerColor}
            strokeWidth="1.3"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </marker>
      </defs>
      <BaseEdge
        id={id}
        path={path}
        markerStart={markerStart}
        markerEnd={markerEnd}
        className={cn(
          "transition-all",
          selected
            ? isInvalid
              ? "stroke-red-600 stroke-[2.8]"
              : "stroke-[var(--action-primary)] stroke-[2.5]"
            : isInvalid
              ? "stroke-red-500 stroke-[2.2]"
              : isLowConfidence
                ? "stroke-amber-600 stroke-2"
                : "stroke-[var(--border-strong)] stroke-[1.6]",
          hasDash ? "[stroke-dasharray:6_4]" : ""
        )}
        onMouseEnter={() => {
          setHovered(true);
        }}
        onMouseLeave={() => {
          setHovered(false);
        }}
        data-confidence-band={confidenceBand}
        data-selected={selected ? "true" : "false"}
        data-testid="modeling-flow-edge-path"
      />
      {shouldShowDetailCard ? (
        <g
          transform={`translate(${labelX}, ${labelY})`}
          pointerEvents="none"
          data-testid="modeling-flow-edge-hover-card"
        >
          <foreignObject x={-210} y={-236} width={420} height={216}>
            <div className="min-w-[420px] overflow-hidden rounded-md border border-[var(--border-default)] bg-white shadow-[0_12px_28px_rgba(15,23,42,0.18)]">
              <div className="border-b border-[var(--border-default)] px-4 py-2 text-sm font-medium text-[var(--text-primary)]">
                Relationship
              </div>
              <div className="grid grid-cols-2 gap-6 px-4 py-3 text-sm">
                <div className="space-y-1">
                  <p className="text-xs text-[var(--text-tertiary)]">From</p>
                  <p className="break-all text-sm text-[var(--text-primary)]">{fromPath}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-[var(--text-tertiary)]">To</p>
                  <p className="break-all text-sm text-[var(--text-primary)]">{toPath}</p>
                </div>
              </div>
              <div className="space-y-2 px-4 pb-4 text-sm">
                <div className="space-y-1">
                  <p className="text-xs text-[var(--text-tertiary)]">Type</p>
                  <p className="text-sm text-[var(--text-primary)]">{relationshipTypeLabel}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-[var(--text-tertiary)]">Description</p>
                  <p className="text-sm text-[var(--text-primary)]">
                    {edgeData?.description?.trim() || "-"}
                  </p>
                </div>
              </div>
            </div>
          </foreignObject>
        </g>
      ) : null}
    </>
  );
}
