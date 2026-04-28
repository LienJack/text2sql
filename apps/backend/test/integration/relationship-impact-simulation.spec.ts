import { RelationshipImpactSimulatorService } from "../../src/modules/knowledge/semantic-spine/relationship-impact-simulator.service";

describe("relationship impact simulation", () => {
  const simulator = new RelationshipImpactSimulatorService();

  it("returns low risk for clean graph edges", () => {
    const result = simulator.simulate({
      edges: [
        {
          id: "edge-orders-customers",
          bridge: {
            left: {
              dataset: "sales",
              table: "orders",
              column: "customer_id"
            },
            right: {
              dataset: "crm",
              table: "customers",
              column: "id"
            },
            operator: "eq",
            confidence: 0.92
          }
        }
      ]
    });

    expect(result.riskLevel).toBe("low");
    expect(result.blockingReasons).toEqual([]);
    expect(result.affectedTableCount).toBe(2);
  });

  it("returns high risk when duplicate or low-confidence edges are detected", () => {
    const result = simulator.simulate({
      edges: [
        {
          id: "edge-1",
          bridge: {
            left: {
              dataset: "sales",
              table: "orders",
              column: "customer_id"
            },
            right: {
              dataset: "crm",
              table: "customers",
              column: "id"
            },
            operator: "eq",
            confidence: 0.3
          }
        },
        {
          id: "edge-2",
          bridge: {
            left: {
              dataset: "sales",
              table: "orders",
              column: "customer_id"
            },
            right: {
              dataset: "crm",
              table: "customers",
              column: "id"
            },
            operator: "eq",
            confidence: 0.91
          }
        }
      ]
    });

    expect(result.riskLevel).toBe("high");
    expect(result.blockingReasons).toEqual(
      expect.arrayContaining([
        "duplicate_relationship_edges_detected",
        "low_confidence_relationship_edges_detected"
      ])
    );
  });
});
