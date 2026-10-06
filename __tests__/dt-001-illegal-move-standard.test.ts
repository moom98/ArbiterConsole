import { describe, it, expect } from "vitest";
import { IllegalMoveStandardTree } from "@/lib/domain/decision-trees/dt-001-illegal-move-standard";

describe("DT-001: Illegal Move Standard", () => {
  const tree = new IllegalMoveStandardTree();

  describe("Clock not pressed", () => {
    it("should return no penalty when clock not pressed", () => {
      const result = tree.evaluate({
        playerColor: "white",
        clockPressed: false,
        opponentMoved: false,
        playerIncidentCount: 0,
      });

      expect(result.conclusion).toContain("時計が押されていないため");
      expect(result.penalties).toHaveLength(0);
      expect(result.confidence).toBe("high");
      expect(result.escalationRecommended).toBe(false);
    });
  });

  describe("Opponent already moved", () => {
    it("should return no correction when opponent moved", () => {
      const result = tree.evaluate({
        playerColor: "white",
        clockPressed: true,
        opponentMoved: true,
        playerIncidentCount: 0,
      });

      expect(result.conclusion).toContain("相手がすでに次の手を指したため");
      expect(result.penalties).toHaveLength(0);
      expect(result.confidence).toBe("high");
    });
  });

  describe("First illegal move", () => {
    it("should add 2 minutes to opponent for first offense", () => {
      const result = tree.evaluate({
        playerColor: "white",
        clockPressed: true,
        opponentMoved: false,
        playerIncidentCount: 0,
      });

      expect(result.conclusion).toContain("1回目のIllegal Move");
      expect(result.penalties).toHaveLength(1);
      expect(result.penalties[0].type).toBe("time-addition-opponent");
      expect(result.penalties[0].timeAdjustmentSeconds).toBe(120);
      expect(result.penalties[0].playerColor).toBe("black");
      expect(result.confidence).toBe("high");
      expect(result.escalationRecommended).toBe(false);
    });

    it("should add time to white when black makes illegal move", () => {
      const result = tree.evaluate({
        playerColor: "black",
        clockPressed: true,
        opponentMoved: false,
        playerIncidentCount: 0,
      });

      expect(result.penalties[0].playerColor).toBe("white");
    });
  });

  describe("Second illegal move", () => {
    it("should declare game loss for second offense", () => {
      const result = tree.evaluate({
        playerColor: "white",
        clockPressed: true,
        opponentMoved: false,
        playerIncidentCount: 1,
      });

      expect(result.conclusion).toContain("2回目のIllegal Move");
      expect(result.penalties).toHaveLength(1);
      expect(result.penalties[0].type).toBe("game-loss");
      expect(result.penalties[0].playerColor).toBe("white");
      expect(result.confidence).toBe("high");
    });

    it("should declare game loss for third offense", () => {
      const result = tree.evaluate({
        playerColor: "black",
        clockPressed: true,
        opponentMoved: false,
        playerIncidentCount: 2,
      });

      expect(result.conclusion).toContain("3回目のIllegal Move");
      expect(result.penalties[0].type).toBe("game-loss");
      expect(result.penalties[0].playerColor).toBe("black");
    });
  });

  describe("Sources validation", () => {
    it("should include FIDE sources", () => {
      const result = tree.evaluate({
        playerColor: "white",
        clockPressed: true,
        opponentMoved: false,
        playerIncidentCount: 0,
      });

      const fideSources = result.sources.filter((s) => s.source === "FIDE");
      expect(fideSources.length).toBeGreaterThan(0);
      expect(fideSources[0].article).toContain("FIDE");
    });

    it("should include JCF sources", () => {
      const result = tree.evaluate({
        playerColor: "white",
        clockPressed: true,
        opponentMoved: false,
        playerIncidentCount: 0,
      });

      const jcfSources = result.sources.filter((s) => s.source === "JCF");
      expect(jcfSources.length).toBeGreaterThan(0);
    });
  });

  describe("Metadata validation", () => {
    it("should set generatedBy to decision-tree", () => {
      const result = tree.evaluate({
        playerColor: "white",
        clockPressed: true,
        opponentMoved: false,
        playerIncidentCount: 0,
      });

      expect(result.generatedBy).toBe("decision-tree");
      expect(result.validationPassed).toBe(true);
      expect(result.validatedAt).toBeInstanceOf(Date);
    });
  });

  describe("Follow-up requirements", () => {
    it("should require player color", () => {
      const check = IllegalMoveStandardTree.requiresFollowUp({
        clockPressed: true,
        opponentMoved: false,
        playerIncidentCount: 0,
      });

      expect(check.required).toBe(true);
      expect(check.missingFields).toContain("playerColor");
    });

    it("should require clock pressed status", () => {
      const check = IllegalMoveStandardTree.requiresFollowUp({
        playerColor: "white",
        opponentMoved: false,
        playerIncidentCount: 0,
      });

      expect(check.required).toBe(true);
      expect(check.missingFields).toContain("clockPressed");
    });

    it("should require opponent moved status", () => {
      const check = IllegalMoveStandardTree.requiresFollowUp({
        playerColor: "white",
        clockPressed: true,
        playerIncidentCount: 0,
      });

      expect(check.required).toBe(true);
      expect(check.missingFields).toContain("opponentMoved");
    });

    it("should not require follow-up when all fields present", () => {
      const check = IllegalMoveStandardTree.requiresFollowUp({
        playerColor: "white",
        clockPressed: true,
        opponentMoved: false,
        playerIncidentCount: 0,
      });

      expect(check.required).toBe(false);
      expect(check.missingFields).toHaveLength(0);
    });
  });

  describe("Supported subtypes", () => {
    it("should support illegal-move-standard subtype", () => {
      const subtypes = IllegalMoveStandardTree.getSupportedSubtypes();
      expect(subtypes).toContain("illegal-move-standard");
    });
  });
});
