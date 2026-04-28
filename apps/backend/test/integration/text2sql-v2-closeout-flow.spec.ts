import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface FlowNode {
  id: string;
  requirementIds: string[];
  implementationOwners: string[];
  evidenceOwners: string[];
  expectedTestFiles: string[];
  gateRelevance: boolean;
  behaviorTestStatus: string;
  coverageOwnerStatus: string;
}

interface FlowMatrix {
  nodes: FlowNode[];
}

describe("text2sql v2 closeout target flow matrix", () => {
  const matrix = JSON.parse(
    readFileSync(
      resolve(__dirname, "../fixtures/text2sql-v2-closeout-flow-matrix.json"),
      "utf-8"
    )
  ) as FlowMatrix;

  it("keeps every target flow node A-M traceable to requirements, owners, evidence, and behavior tests", () => {
    const expectedNodeIds = [
      "A.context-envelope",
      "B.intake",
      "C.route",
      "C1.targeted-clarification",
      "C2.general-metadata-answer",
      "D.retrieve-context",
      "D1.external-embedding-rerank",
      "D2.schema-ddl-supplement",
      "E.semantic-context-pack",
      "F.semantic-plan",
      "G.plan-confidence",
      "H.structured-sql-generation",
      "I.validation",
      "J.read-only-execution",
      "K.diagnosis-bounded-correction",
      "L.fail-closed-evidence",
      "M.final-answer-replay-artifacts"
    ];

    expect(matrix.nodes.map((node) => node.id)).toEqual(expectedNodeIds);
    for (const node of matrix.nodes) {
      expect(node.requirementIds.length).toBeGreaterThan(0);
      expect(node.implementationOwners.length).toBeGreaterThan(0);
      expect(node.evidenceOwners.length).toBeGreaterThan(0);
      expect(node.expectedTestFiles.length).toBeGreaterThan(0);
      expect(node.gateRelevance).toBe(true);
      expect(["covered", "partial", "planned"]).toContain(node.behaviorTestStatus);
      expect(["covered", "partial", "planned"]).toContain(node.coverageOwnerStatus);
    }
  });

  it("keeps route and convergence nodes linked to semantic plan and runner behavior tests", () => {
    const routeNodeIds = [
      "C.route",
      "C1.targeted-clarification",
      "C2.general-metadata-answer",
      "F.semantic-plan",
      "G.plan-confidence",
      "L.fail-closed-evidence"
    ];
    const routeNodes = matrix.nodes.filter((node) => routeNodeIds.includes(node.id));

    expect(routeNodes).toHaveLength(routeNodeIds.length);
    for (const node of routeNodes) {
      expect(node.expectedTestFiles).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/text2sql-v2-(semantic-plan|runner)|text2sql-v2-closeout-flow/)
        ])
      );
      expect(node.evidenceOwners.join(" ")).toMatch(/trace\.v2|delivery\.evidence\.v2/);
    }
  });
});
