"use client";

import {
  BaseEdge,
  getBezierPath,
  type EdgeProps
} from "@xyflow/react";
import { cn } from "@/lib/utils";

export const MODELING_FLOW_EDGE_TYPE = "modelingFlowEdge";

export type ModelingFlowEdgeData = {
  label: string;
  source: "manual" | "inferred" | "fk" | "semantic";
  confidence: number;
};

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
  const isLowConfidence = confidence < 0.6;
  const hasDash = !selected && (edgeData?.source === "inferred" || isLowConfidence);

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={cn(
          "transition-all",
          selected
            ? "stroke-[var(--action-primary)]"
            : isLowConfidence
              ? "stroke-amber-600"
              : "stroke-[var(--border-strong)]",
          selected ? "stroke-[2.5]" : isLowConfidence ? "stroke-2" : "stroke-[1.6]",
          hasDash ? "[stroke-dasharray:6_4]" : ""
        )}
      />
      {edgeData?.label ? (
        <text
          x={labelX}
          y={labelY}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-[var(--text-secondary)] text-[10px]"
          data-testid="modeling-flow-edge-label"
        >
          {`${edgeData.label} [${edgeData.source} · ${confidence.toFixed(2)}]`}
        </text>
      ) : null}
    </>
  );
}
