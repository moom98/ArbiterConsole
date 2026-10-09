import { describe, expect, it } from "vitest";
import {
  findJevCalibration,
  isValidJevCalibration,
  JEV_CALIBRATIONS,
} from "@/lib/domain/llm/calibration";
import { JEV_1_13_0_CALIBRATION } from "@/lib/domain/llm/calibration/jev-1.13.0";
import { parseLlmClassification } from "@/lib/domain/llm/classification";
import json from "@/lib/domain/llm/calibration/jev-1.13.0.json";
import { DEFAULT_JEV_MODEL } from "@/lib/infrastructure/llm/server/config";

/** J3: 登録した較正は評価スクリプトの出力と一致し、固定したモデルに対応する（fact-model §5.1） */
describe("registered Jev calibration", () => {
  it("matches the evaluation output (jev-1.13.0.json)", () => {
    expect(JEV_1_13_0_CALIBRATION).toEqual(json);
  });

  it("is valid and found for the pinned JEV_MODEL only (not an alias)", () => {
    expect(isValidJevCalibration(JEV_1_13_0_CALIBRATION)).toBe(true);
    expect(JEV_CALIBRATIONS).toContain(JEV_1_13_0_CALIBRATION);
    expect(findJevCalibration(DEFAULT_JEV_MODEL)).toBe(JEV_1_13_0_CALIBRATION);
    expect(findJevCalibration("jev-latest")).toBeUndefined();
  });

  it("has no presence thresholds yet (every fact stays missing)", () => {
    expect(JEV_1_13_0_CALIBRATION.presence).toEqual({});
  });

  it("applies the thresholds: 0.9 → medium with prefill, 0.85 → low with prefill, 0.7 → low without", () => {
    const raw = (p: number) => ({
      provider: "jev",
      category: "draw",
      categoryProbabilities: {
        "illegal-move": 0,
        "board-piece": 0,
        "clock-time": 1 - p,
        "game-result": 0,
        draw: p,
        scoresheet: 0,
        "player-behavior": 0,
        team: 0,
        "fair-play": 0,
        "tournament-admin": 0,
      },
      subtype: "stalemate",
      subtypeProbability: 0.95,
      needsTournamentRulesProbability: 0.2,
    });
    const at = (p: number) =>
      parseLlmClassification(raw(p), { model: "jev-1.13.0" });
    expect(at(0.9)).toMatchObject({
      confidence: "medium",
      prefill: true,
      subtype: "stalemate",
    });
    expect(at(0.9)?.alternatives).toBeUndefined();
    expect(at(0.85)).toMatchObject({ confidence: "low", prefill: true });
    expect(at(0.85)?.alternatives).toHaveLength(2);
    expect(at(0.7)).toMatchObject({ confidence: "low", prefill: false });
    // 別名の応答には適用しない（未較正モード）
    expect(
      parseLlmClassification(raw(0.99), { model: "jev-latest" })
    ).toMatchObject({ confidence: "low", prefill: false });
  });
});
