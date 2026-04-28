"use client";

import {
  BaseEdge,
  getSmoothStepPath,
  type EdgeProps
} from "@xyflow/react";
import { useState } from "react";
import type { ModelingGraphRelationshipType } from "@text2sql/shared-types";
import { cn } from "@/lib/utils";

export const MODELING_FLOW_EDGE_TYPE = "modelingFlowEdge";

export type ModelingFlowEdgeData = {
  label: string;
  source: "manual" | "inferred" | "fk" | "semantic";
  confidence: number;
  type?: ModelingGraphRelationshipType | "many-to-many";
  cardinality?: ModelingGraphRelationshipType | "many-to-many";
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
  highlightedBySelectedRelationship?: boolean;
  highlightedBySelectedModel?: boolean;
};

type ModelingFlowEdgeVisualState =
  | "invalid"
  | "selected-relationship"
  | "selected-model-incident"
  | "inferred-or-low-confidence"
  | "normal";

function resolveEdgeRelationshipType(
  edgeData?: ModelingFlowEdgeData
): ModelingGraphRelationshipType | "many-to-many" | null {
  const relationshipType = edgeData?.type ?? edgeData?.cardinality;
  if (
    relationshipType === "many-to-one" ||
    relationshipType === "one-to-many" ||
    relationshipType === "one-to-one" ||
    relationshipType === "many-to-many"
  ) {
    return relationshipType;
  }
  return null;
}

function resolveEndpointMarkers(
  relationshipType: ModelingGraphRelationshipType | "many-to-many" | null
): {
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
  if (relationshipType === "many-to-many") {
    return {
      source: "many",
      target: "many"
    };
  }
  return {
    source: "none",
    target: "none"
  };
}

function resolveCardinalityBadgeText(value: "one" | "many" | "none"): string {
  if (value === "one") {
    return "1";
  }
  if (value === "many") {
    return "N";
  }
  return "";
}

function resolveCardinalityBadgeOffset(
  position: string | null | undefined
): { x: number; y: number } {
  if (position === "left") {
    return { x: -14, y: 0 };
  }
  if (position === "right") {
    return { x: 14, y: 0 };
  }
  if (position === "top") {
    return { x: 0, y: -14 };
  }
  if (position === "bottom") {
    return { x: 0, y: 14 };
  }
  return { x: 0, y: 0 };
}

function resolveRelationshipTypeLabel(
  relationshipType: ModelingGraphRelationshipType | "many-to-many" | null
): string {
  if (relationshipType === "one-to-many") {
    return "1对多 (One-to-many)";
  }
  if (relationshipType === "many-to-one") {
    return "1对多 (Many-to-one)";
  }
  if (relationshipType === "one-to-one") {
    return "1对1 (One-to-one)";
  }
  if (relationshipType === "many-to-many") {
    return "多对多 (Many-to-many)";
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

function resolveEdgeVisualState(params: {
  invalid: boolean;
  selectedRelationship: boolean;
  selectedModelIncident: boolean;
  inferred: boolean;
  lowConfidence: boolean;
}): ModelingFlowEdgeVisualState {
  const { invalid, selectedRelationship, selectedModelIncident, inferred, lowConfidence } = params;
  if (invalid) {
    return "invalid";
  }
  if (selectedRelationship) {
    return "selected-relationship";
  }
  if (selectedModelIncident) {
    return "selected-model-incident";
  }
  if (inferred || lowConfidence) {
    return "inferred-or-low-confidence";
  }
  return "normal";
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
  const isInferred = edgeData?.source === "inferred";
  const isLowConfidence = !isInvalid && confidence < 0.6;
  const selectedRelationship = Boolean(selected || edgeData?.highlightedBySelectedRelationship);
  const selectedModelIncident = Boolean(edgeData?.highlightedBySelectedModel) && !selectedRelationship;
  const visualState = resolveEdgeVisualState({
    invalid: isInvalid,
    selectedRelationship,
    selectedModelIncident,
    inferred: isInferred,
    lowConfidence: isLowConfidence
  });
  const hasDash = visualState === "invalid" || visualState === "inferred-or-low-confidence";
  const confidenceBand = isInvalid
    ? "invalid"
    : isLowConfidence
      ? "low"
      : isInferred
        ? "inferred"
        : "normal";
  const fromPath = formatEndpointPath(edgeData?.from);
  const toPath = formatEndpointPath(edgeData?.to);
  const sourceBadgeText = resolveCardinalityBadgeText(markerType.source);
  const targetBadgeText = resolveCardinalityBadgeText(markerType.target);
  const sourceBadgeOffset = resolveCardinalityBadgeOffset(sourcePosition);
  const targetBadgeOffset = resolveCardinalityBadgeOffset(targetPosition);
  const badgeColor =
    visualState === "invalid"
      ? "#dc2626"
      : visualState === "selected-relationship"
        ? "var(--action-primary)"
        : isLowConfidence
          ? "#b45309"
          : "#64748b";
  const badgeRadius = 10;
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
      <BaseEdge
        id={id}
        path={path}
        className={cn(
          "transition-all",
          visualState === "invalid"
            ? "stroke-red-600 stroke-[2.8]"
            : visualState === "selected-relationship"
              ? "stroke-[var(--action-primary)] stroke-[2.7]"
              : visualState === "selected-model-incident"
                ? "stroke-slate-400 stroke-[2.1]"
                : visualState === "inferred-or-low-confidence"
                  ? isLowConfidence
                    ? "stroke-amber-600 stroke-2"
                    : "stroke-slate-500 stroke-[1.9]"
                  : "stroke-[var(--border-strong)] stroke-[1.6]",
          hasDash || visualState === "selected-model-incident" ? "[stroke-dasharray:6_4]" : ""
        )}
        onMouseEnter={() => {
          setHovered(true);
        }}
        onMouseLeave={() => {
          setHovered(false);
        }}
        data-confidence-band={confidenceBand}
        data-selected={selectedRelationship ? "true" : "false"}
        data-visual-state={visualState}
        data-testid="modeling-flow-edge-path"
      />
      {sourceBadgeText ? (
        <g
          transform={`translate(${sourceX + sourceBadgeOffset.x}, ${sourceY + sourceBadgeOffset.y})`}
          pointerEvents="none"
          data-testid="modeling-flow-edge-source-cardinality"
        >
          <circle r={badgeRadius} fill={badgeColor} stroke="white" strokeWidth="1.6" />
          <text
            x={0}
            y={0}
            textAnchor="middle"
            dominantBaseline="central"
            fill="white"
            fontSize="11"
            fontWeight="700"
          >
            {sourceBadgeText}
          </text>
        </g>
      ) : null}
      {targetBadgeText ? (
        <g
          transform={`translate(${targetX + targetBadgeOffset.x}, ${targetY + targetBadgeOffset.y})`}
          pointerEvents="none"
          data-testid="modeling-flow-edge-target-cardinality"
        >
          <circle r={badgeRadius} fill={badgeColor} stroke="white" strokeWidth="1.6" />
          <text
            x={0}
            y={0}
            textAnchor="middle"
            dominantBaseline="central"
            fill="white"
            fontSize="11"
            fontWeight="700"
          >
            {targetBadgeText}
          </text>
        </g>
      ) : null}
      {shouldShowDetailCard ? (
        <g
          transform={`translate(${labelX}, ${labelY})`}
          pointerEvents="none"
          data-testid="modeling-flow-edge-hover-card"
        >
          <foreignObject x={-230} y={-248} width={460} height={242}>
            <div className="w-[460px] overflow-hidden rounded-md border border-[var(--border-default)] bg-white shadow-[0_12px_28px_rgba(15,23,42,0.18)]">
              <div className="border-b border-[var(--border-default)] px-4 py-2 text-sm font-medium text-[var(--text-primary)]">
                Relationship
              </div>
              <div className="space-y-2 px-4 py-3 text-sm">
                <div className="space-y-1">
                  <p className="text-xs text-[var(--text-tertiary)]">From</p>
                  <p className="overflow-x-auto whitespace-nowrap rounded border border-[var(--border-default)] bg-[var(--surface-muted)]/35 px-2 py-1 text-sm font-mono text-[var(--text-primary)]">
                    {fromPath}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-[var(--text-tertiary)]">To</p>
                  <p className="overflow-x-auto whitespace-nowrap rounded border border-[var(--border-default)] bg-[var(--surface-muted)]/35 px-2 py-1 text-sm font-mono text-[var(--text-primary)]">
                    {toPath}
                  </p>
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
