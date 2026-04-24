"use client";

import {
  BaseEdge,
  getBezierPath,
  type EdgeProps
} from "@xyflow/react";
import type { ModelingGraphRelationshipType } from "@text2sql/shared-types";
import { cn } from "@/lib/utils";

export const MODELING_FLOW_EDGE_TYPE = "modelingFlowEdge";

export type ModelingFlowEdgeData = {
  label: string;
  source: "manual" | "inferred" | "fk" | "semantic";
  confidence: number;
  type?: ModelingGraphRelationshipType;
  cardinality?: ModelingGraphRelationshipType;
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
  const confidence = edgeData?.confidence ?? 1;
  const relationshipType = resolveEdgeRelationshipType(edgeData);
  const isInvalid = Boolean(edgeData?.invalid);
  const isLowConfidence = !isInvalid && confidence < 0.6;
  const hasDash = !selected && (isInvalid || edgeData?.source === "inferred" || isLowConfidence);
  const confidenceBand = isInvalid ? "invalid" : isLowConfidence ? "low" : "normal";

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition
  });

  const labelSegments = [
    isInvalid ? "invalid" : null,
    relationshipType,
    edgeData?.source,
    confidence.toFixed(2)
  ].filter(Boolean);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
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
        data-confidence-band={confidenceBand}
        data-selected={selected ? "true" : "false"}
        data-testid="modeling-flow-edge-path"
      />
      {edgeData?.label ? (
        <text
          x={labelX}
          y={labelY}
          textAnchor="middle"
          dominantBaseline="middle"
          className={cn(
            "text-[10px]",
            isInvalid ? "fill-red-700" : "fill-[var(--text-secondary)]"
          )}
          data-confidence-band={confidenceBand}
          data-testid="modeling-flow-edge-label"
        >
          {`${edgeData.label} [${labelSegments.join(" · ")}]`}
        </text>
      ) : null}
    </>
  );
}
