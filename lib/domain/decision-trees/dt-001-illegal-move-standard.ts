import type { Decision, Penalty } from "@/lib/domain/entities";

export interface IllegalMoveStandardInput {
  playerColor: "white" | "black";
  clockPressed: boolean;
  opponentMoved: boolean;
  playerIncidentCount: number; // このプレイヤーの過去のIllegal Move回数
  moveDescription?: string;
}

/**
 * DT-001: Illegal Move (Standard)
 * FIDE Laws of Chess Article 7.5.4, 7.5.5
 */
export class IllegalMoveStandardTree {
  /**
   * Decision Treeを評価
   */
  evaluate(input: IllegalMoveStandardInput): Decision {
    // 1. 時計が押されていない場合 → Illegal Move未成立
    if (!input.clockPressed) {
      return {
        id: crypto.randomUUID(),
        incidentId: "", // 後でセット
        conclusion:
          "時計が押されていないため、Illegal Moveは未成立です。プレイヤーに正しい手を指すよう指示してください。",
        actions: ["プレイヤーに正しい手を指すよう伝える"],
        intervention: "immediate",
        penalties: [],
        sources: [
          {
            article: "FIDE 7.5.1",
            text: "An illegal move is completed once the player has pressed his clock.",
            source: "FIDE",
            priority: 10,
          },
        ],
        confidence: "high",
        escalationRecommended: false,
        generatedBy: "decision-tree",
        validatedAt: new Date(),
        validationPassed: true,
        createdAt: new Date(),
      };
    }

    // 2. 相手がすでに次の手を指した場合 → 訂正不可
    if (input.opponentMoved) {
      return {
        id: crypto.randomUUID(),
        incidentId: "",
        conclusion:
          "相手がすでに次の手を指したため、Illegal Moveは訂正できません。局面はそのまま続行されます。",
        actions: [
          "局面をそのまま続行させる",
          "特別なペナルティはなし",
          "今後の手順を監視する",
        ],
        intervention: "immediate",
        penalties: [],
        sources: [
          {
            article: "FIDE 7.5.3",
            text: "If the opponent has made his move, the illegal move cannot be corrected.",
            source: "FIDE",
            priority: 10,
          },
        ],
        confidence: "high",
        escalationRecommended: false,
        generatedBy: "decision-tree",
        validatedAt: new Date(),
        validationPassed: true,
        createdAt: new Date(),
      };
    }

    // 3. 1回目のIllegal Move → 相手に2分追加
    if (input.playerIncidentCount === 0) {
      const penalty: Penalty = {
        type: "time-addition-opponent",
        playerColor:
          input.playerColor === "white" ? "black" : "white",
        timeAdjustmentSeconds: 120,
        description: `${input.playerColor === "white" ? "黒" : "白"}に2分追加`,
      };

      return {
        id: crypto.randomUUID(),
        incidentId: "",
        conclusion: `${input.playerColor === "white" ? "白" : "黒"}の1回目のIllegal Moveです。相手に2分を追加し、正しい手に訂正してください。`,
        actions: [
          "時計を止める",
          "Illegal Moveを指摘する",
          "局面を違法手の前に戻す",
          `${input.playerColor === "white" ? "黒" : "白"}の時計に2分追加`,
          "正しい手を指すよう指示",
          "時計を再開",
        ],
        intervention: "immediate",
        penalties: [penalty],
        sources: [
          {
            article: "FIDE 7.5.4",
            text: "If the arbiter observes an illegal move has been completed, he shall declare the game lost by the player, provided the opponent has not made his next move. If the arbiter does not intervene, the opponent is entitled to claim a win, provided the opponent has not made his next move.",
            source: "FIDE",
            priority: 10,
          },
          {
            article: "FIDE 7.5.5",
            text: "If during a game it is found that an illegal move has been completed, the position immediately before the irregularity shall be reinstated. If the position immediately before the irregularity cannot be determined, the game shall continue from the last identifiable position prior to the irregularity. Articles 4.3 and 4.7 apply to the move replacing the illegal move. The game shall then continue from this reinstated position.",
            source: "FIDE",
            priority: 10,
          },
          {
            article: "JCF NA p.48",
            text: "Standard timeではIllegal Move 1回目は相手に2分追加",
            source: "JCF",
            priority: 100,
          },
        ],
        confidence: "high",
        escalationRecommended: false,
        generatedBy: "decision-tree",
        validatedAt: new Date(),
        validationPassed: true,
        createdAt: new Date(),
      };
    }

    // 4. 2回目以降のIllegal Move → Game Loss
    const penalty: Penalty = {
      type: "game-loss",
      playerColor: input.playerColor,
      description: `${input.playerColor === "white" ? "白" : "黒"}の負け`,
    };

    return {
      id: crypto.randomUUID(),
      incidentId: "",
      conclusion: `${input.playerColor === "white" ? "白" : "黒"}の${input.playerIncidentCount + 1}回目のIllegal Moveです。このプレイヤーの負けとなります。`,
      actions: [
        "時計を止める",
        "Illegal Moveを指摘する",
        `${input.playerColor === "white" ? "白" : "黒"}の負けを宣言`,
        "結果を記録",
      ],
      intervention: "immediate",
      penalties: [penalty],
      sources: [
        {
          article: "FIDE 7.5.5",
          text: "After the action taken under Article 7.5.4, for the first two illegal moves by a player the arbiter shall give two minutes extra time to his opponent in each instance; for a third illegal move by the same player, the arbiter shall declare the game lost by this player.",
          source: "FIDE",
          priority: 10,
        },
        {
          article: "JCF NA p.48",
          text: "Standard timeではIllegal Move 2回目は即負け",
          source: "JCF",
          priority: 100,
        },
      ],
      confidence: "high",
      escalationRecommended: false,
      generatedBy: "decision-tree",
      validatedAt: new Date(),
      validationPassed: true,
      createdAt: new Date(),
    };
  }

  /**
   * このDecision Treeが処理できるincident subtypeを返す
   */
  static getSupportedSubtypes(): string[] {
    return ["illegal-move-standard"];
  }

  /**
   * 追加情報が必要かどうかを判定
   */
  static requiresFollowUp(
    currentInput: Partial<IllegalMoveStandardInput>
  ): {
    required: boolean;
    missingFields: string[];
  } {
    const missingFields: string[] = [];

    if (currentInput.playerColor === undefined) {
      missingFields.push("playerColor");
    }
    if (currentInput.clockPressed === undefined) {
      missingFields.push("clockPressed");
    }
    if (currentInput.opponentMoved === undefined) {
      missingFields.push("opponentMoved");
    }
    if (currentInput.playerIncidentCount === undefined) {
      missingFields.push("playerIncidentCount");
    }

    return {
      required: missingFields.length > 0,
      missingFields,
    };
  }
}
