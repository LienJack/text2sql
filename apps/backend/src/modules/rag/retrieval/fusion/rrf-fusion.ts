import {
  RAG_RETRIEVAL_LANES,
  type RagRetrievalCandidate,
  type RagRetrievalLane,
  type RagRetrievalLaneHit
} from "../rag-retrieval.types";

export const DEFAULT_RRF_RANK_CONSTANT = 60;

export interface RrfFusionInput {
  laneHits: Record<RagRetrievalLane, RagRetrievalLaneHit[]>;
  rankConstant?: number;
}

interface RrfAccumulator {
  chunk_id: string;
  source_lane: RagRetrievalLane;
  best_rank: number;
  score: number;
  lane_scores: Partial<Record<RagRetrievalLane, number>>;
  lane_ranks: Partial<Record<RagRetrievalLane, number>>;
  evidence: string[];
  chunk: RagRetrievalLaneHit["chunk"];
}

export const fuseWithRrf = (input: RrfFusionInput): RagRetrievalCandidate[] => {
  const rankConstant = normalizeRankConstant(input.rankConstant);
  const accumulatorByChunkId = new Map<string, RrfAccumulator>();

  for (const lane of RAG_RETRIEVAL_LANES) {
    const laneHits = stableSortLaneHits(input.laneHits[lane] ?? []);
    for (let index = 0; index < laneHits.length; index += 1) {
      const hit = laneHits[index];
      const rank = index + 1;
      const rrfContribution = 1 / (rankConstant + rank);
      const existing = accumulatorByChunkId.get(hit.chunk_id);

      if (!existing) {
        accumulatorByChunkId.set(hit.chunk_id, {
          chunk_id: hit.chunk_id,
          source_lane: lane,
          best_rank: rank,
          score: rrfContribution,
          lane_scores: { [lane]: hit.score },
          lane_ranks: { [lane]: rank },
          evidence: [...hit.evidence],
          chunk: hit.chunk
        });
        continue;
      }

      existing.score += rrfContribution;
      existing.lane_scores[lane] = hit.score;
      existing.lane_ranks[lane] = rank;
      appendUnique(existing.evidence, hit.evidence);

      if (rank < existing.best_rank) {
        existing.best_rank = rank;
        existing.source_lane = lane;
      } else if (rank === existing.best_rank) {
        const existingLaneOrder = laneOrder(existing.source_lane);
        const nextLaneOrder = laneOrder(lane);
        if (nextLaneOrder < existingLaneOrder) {
          existing.source_lane = lane;
        }
      }
    }
  }

  return Array.from(accumulatorByChunkId.values())
    .map((item) => ({
      chunk_id: item.chunk_id,
      source_lane: item.source_lane,
      evidence: item.evidence,
      score: normalizeScore(item.score),
      lane_scores: item.lane_scores,
      lane_ranks: item.lane_ranks,
      chunk: item.chunk
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.chunk_id.localeCompare(right.chunk_id);
    });
};

const stableSortLaneHits = (hits: RagRetrievalLaneHit[]): RagRetrievalLaneHit[] =>
  [...hits].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.chunk_id.localeCompare(right.chunk_id);
  });

const appendUnique = (target: string[], values: string[]): void => {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
};

const laneOrder = (lane: RagRetrievalLane): number => RAG_RETRIEVAL_LANES.indexOf(lane);

const normalizeRankConstant = (rankConstant?: number): number => {
  if (typeof rankConstant !== "number" || !Number.isFinite(rankConstant) || rankConstant < 1) {
    return DEFAULT_RRF_RANK_CONSTANT;
  }
  return Math.floor(rankConstant);
};

const normalizeScore = (value: number): number => Number(value.toFixed(12));
