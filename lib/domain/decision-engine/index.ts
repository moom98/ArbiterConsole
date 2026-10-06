import type { Incident, Decision } from "@/lib/domain/entities";
import {
  IllegalMoveStandardTree,
  type IllegalMoveStandardInput,
} from "@/lib/domain/decision-trees/dt-001-illegal-move-standard";

export interface DecisionEngineContext {
  incident: Incident;
  gameContext?: {
    tournamentId: string;
    gameId: string;
    competitionType: "standard" | "rapid" | "blitz";
    rapidRulesType?: "A4" | "A5";
  };
  playerIncidentHistory?: {
    white: number;
    black: number;
  };
}

export interface DecisionEngineResult {
  decision: Decision;
  requiresFollowUp: boolean;
  missingFields?: string[];
}

/**
 * Decision Engine - Orchestrator
 * IncidentをDecision TreeまたはLLMにルーティング
 */
export class DecisionEngine {
  /**
   * Incidentを処理してDecisionを生成
   */
  async processIncident(
    context: DecisionEngineContext
  ): Promise<DecisionEngineResult> {
    const { incident, gameContext, playerIncidentHistory } = context;

    // 1. Category/Subtypeに基づいてDecision Treeを選択
    if (incident.category === "illegal-move") {
      return this.processIllegalMove(
        incident,
        gameContext,
        playerIncidentHistory
      );
    }

    // 2. Decision Treeが存在しない場合
    return this.createManualReviewDecision(incident);
  }

  /**
   * Illegal Move系の処理
   */
  private async processIllegalMove(
    incident: Incident,
    gameContext?: DecisionEngineContext["gameContext"],
    playerIncidentHistory?: DecisionEngineContext["playerIncidentHistory"]
  ): Promise<DecisionEngineResult> {
    // 競技タイプに基づいて適切なTreeを選択
    const competitionType = gameContext?.competitionType || "standard";

    if (competitionType === "standard") {
      return this.processIllegalMoveStandard(
        incident,
        playerIncidentHistory
      );
    }

    // Rapid/Blitzの場合は未実装
    return this.createManualReviewDecision(
      incident,
      "Rapid/Blitz timeのIllegal Move処理は現在実装されていません。"
    );
  }

  /**
   * Illegal Move Standard の処理
   */
  private async processIllegalMoveStandard(
    incident: Incident,
    playerIncidentHistory?: DecisionEngineContext["playerIncidentHistory"]
  ): Promise<DecisionEngineResult> {
    // Incidentの説明文から必要な情報を抽出（簡易版）
    const input = this.parseIllegalMoveInput(
      incident,
      playerIncidentHistory
    );

    // Follow-upが必要かチェック
    const followUpCheck =
      IllegalMoveStandardTree.requiresFollowUp(input);
    if (followUpCheck.required) {
      return {
        decision: this.createFollowUpDecision(
          incident,
          followUpCheck.missingFields
        ),
        requiresFollowUp: true,
        missingFields: followUpCheck.missingFields,
      };
    }

    // Decision Tree実行
    const tree = new IllegalMoveStandardTree();
    const decision = tree.evaluate(
      input as IllegalMoveStandardInput
    );

    // Incident IDをセット
    decision.incidentId = incident.id;

    return {
      decision,
      requiresFollowUp: false,
    };
  }

  /**
   * Incident説明文からIllegalMoveStandardInputを抽出
   */
  private parseIllegalMoveInput(
    incident: Incident,
    playerIncidentHistory?: DecisionEngineContext["playerIncidentHistory"]
  ): Partial<IllegalMoveStandardInput> {
    const input: Partial<IllegalMoveStandardInput> = {};

    // 簡易的なパース（実際にはより高度な解析が必要）
    const desc = incident.description.toLowerCase();

    // Player color detection
    if (desc.includes("白") || desc.includes("white")) {
      input.playerColor = "white";
    } else if (desc.includes("黒") || desc.includes("black")) {
      input.playerColor = "black";
    }

    // Clock pressed detection
    if (
      desc.includes("時計を押した") ||
      desc.includes("clock pressed") ||
      desc.includes("時計押下")
    ) {
      input.clockPressed = true;
    } else if (desc.includes("時計を押していない")) {
      input.clockPressed = false;
    }

    // Opponent moved detection
    if (
      desc.includes("相手が指した") ||
      desc.includes("opponent moved")
    ) {
      input.opponentMoved = true;
    } else if (
      desc.includes("相手はまだ") ||
      desc.includes("opponent has not")
    ) {
      input.opponentMoved = false;
    }

    // Player incident count
    if (input.playerColor && playerIncidentHistory) {
      input.playerIncidentCount =
        playerIncidentHistory[input.playerColor] || 0;
    }

    return input;
  }

  /**
   * Follow-upが必要な場合のDecision
   */
  private createFollowUpDecision(
    incident: Incident,
    missingFields: string[]
  ): Decision {
    const fieldNames: Record<string, string> = {
      playerColor: "どちらのプレイヤーか（白/黒）",
      clockPressed: "時計を押したかどうか",
      opponentMoved: "相手が次の手を指したかどうか",
      playerIncidentCount: "このプレイヤーの過去のIllegal Move回数",
    };

    const missingFieldsText = missingFields
      .map((f) => `・${fieldNames[f] || f}`)
      .join("\n");

    return {
      id: crypto.randomUUID(),
      incidentId: incident.id,
      conclusion: "追加情報が必要です。",
      actions: ["以下の情報を確認してください：", missingFieldsText],
      intervention: "consult-ca",
      penalties: [],
      sources: [],
      confidence: "low",
      escalationRecommended: true,
      escalationReason: "必要な情報が不足しています",
      generatedBy: "decision-tree",
      validatedAt: new Date(),
      validationPassed: true,
      createdAt: new Date(),
    };
  }

  /**
   * Manual Review が必要な場合のDecision
   */
  private createManualReviewDecision(
    incident: Incident,
    reason?: string
  ): DecisionEngineResult {
    const decision: Decision = {
      id: crypto.randomUUID(),
      incidentId: incident.id,
      conclusion: "この事象は手動での確認が必要です。",
      actions: [
        "ルール検索で関連規則を確認してください。",
        "Chief Arbiterへ相談してください。",
      ],
      intervention: "consult-ca",
      penalties: [],
      sources: [],
      confidence: "low",
      escalationRecommended: true,
      escalationReason:
        reason ||
        "このカテゴリのDecision Treeは実装されていません",
      generatedBy: "decision-tree",
      validatedAt: new Date(),
      validationPassed: true,
      createdAt: new Date(),
    };

    return {
      decision,
      requiresFollowUp: false,
    };
  }
}

export * from "@/lib/domain/decision-trees/dt-001-illegal-move-standard";
