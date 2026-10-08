/**
 * メイト可能性（FIDE 6.9 / 7.5.5 / A.5.3）の判定（ADR-014 §5、ADR-015）。純粋関数。
 *
 * 「相手が、あらゆる合法手の連続によって（相手の協力を含む）キングをチェックメイトできるか」:
 * - cannot-mate: 駒の構成だけで不可能が証明できる場合だけ（mate-material.ts）
 * - can-mate:    局面から実際にメイトまでの合法手の手順を見つけ、ChessPositionPort（chess.js、
 *                strict）で再生して確かめた場合だけ。手順は証拠として表示する
 * - unknown:     それ以外（局面なし・不正な局面・手順が見つからない・手順を検証できない）
 *
 * 手順の探索（Web Worker のヘルプメイト探索）は時間がかかるため、ここでは行わない。
 * アプリケーション層が探索して Incident.mateSearch に保存し、ここでは毎回その手順を検証する。
 * 一般的な insufficientMaterial 判定は 6.9 の判定として使わない。
 */

import type {
  Incident,
  MateSearchRecord,
  PlayerColor,
} from "@/lib/domain/entities";
import { materialCannotMate, materialFromFen } from "./mate-material";
import {
  SEVENTY_FIVE_MOVES_PLIES,
  type ChessPositionPort,
} from "./position-analysis";

/** ヘルプメイト探索の版。変えると、以前に見つからなかった局面を探し直す */
export const HELPMATE_ENGINE_VERSION = "helpmate-1";

export type MateVerdict = "can-mate" | "cannot-mate" | "unknown";

/**
 * unknown の原因
 * - no-position:        局面が入力されていない
 * - invalid-position:   FEN を解釈できない、または実戦で起こりえない局面
 * - wrong-side-to-move: 手番が求める側でない（7.5.5 の局面は違反者の手番）
 * - not-searched:       手順をまだ探していない（探索を利用できない）
 * - not-found:          上限内に手順が見つからなかった
 * - evidence-invalid:   保存された手順を検証できなかった
 */
export type MateUnknownCause =
  | "no-position"
  | "invalid-position"
  | "wrong-side-to-move"
  | "not-searched"
  | "not-found"
  | "evidence-invalid";

export interface MatePossibility {
  verdict: MateVerdict;
  /** 表示用の理由 */
  reason: string;
  cause?: MateUnknownCause;
  /** can-mate: 検証済みのメイトまでの手順（例: "52... Kh8 53. Qg7#"） */
  line?: string;
}

/** メイト可能性を判定する局面と、メイトする側 */
export interface MatePositionRequest {
  fen: string;
  attacker: PlayerColor;
  /** 局面の手番がこの側でなければならない（7.5.5: 違反者の手番に戻した局面） */
  requiredSideToMove?: PlayerColor;
}

/**
 * ヘルプメイト探索のポート（実装はインフラ層の Web Worker。ADR-015）。
 * 結果は証拠の候補にすぎず、assessMatePossibility が毎回検証する。
 */
export interface HelpmateSearchPort {
  search(request: MatePositionRequest): Promise<MateSearchRecord>;
}

const COLOR_JA: Record<PlayerColor, string> = { white: "白", black: "黒" };

const other = (c: PlayerColor): PlayerColor =>
  c === "white" ? "black" : "white";

/**
 * Incident の回答から、メイト可能性の判定に使う局面とメイトする側を求める。
 * 局面が入力されていない、またはメイトする側が決まらない場合は undefined。
 * - 違法手（7.5.5）: 違法手の直前に戻した局面。違反者の相手がメイトする側
 * - フラッグ（6.9 / A.5.3）: フラッグ確定時の局面。時間切れでない側がメイトする側
 */
export function matePositionRequest(
  incident: Incident
): MatePositionRequest | undefined {
  if (incident.category === "illegal-move") {
    const facts = incident.illegalMoveFacts;
    const offender = incident.playerColor;
    if (facts?.matePosition !== "fen" || !facts.positionFen || !offender)
      return undefined;
    return {
      fen: facts.positionFen,
      attacker: other(offender),
      requiredSideToMove: offender,
    };
  }
  if (incident.category === "clock-time" && incident.subtype === "flag-fall") {
    const facts = incident.flagFallFacts;
    if (facts?.matePosition !== "fen" || !facts.fen) return undefined;
    const flagged: PlayerColor | undefined =
      facts.flagFallen === "white" || facts.flagFallen === "black"
        ? facts.flagFallen
        : facts.flagFallen === "both" && facts.bothFlagsOrder === "white-first"
          ? "white"
          : facts.flagFallen === "both" &&
              facts.bothFlagsOrder === "black-first"
            ? "black"
            : undefined;
    if (!flagged) return undefined;
    return { fen: facts.fen, attacker: other(flagged) };
  }
  return undefined;
}

/** 局面の検査（FEN・起こりえない局面・手番）。問題があれば unknown の判定 */
function checkPosition(
  port: ChessPositionPort,
  request: MatePositionRequest
): MatePossibility | undefined {
  const n = port.normalize(request.fen);
  if (!n.ok)
    return {
      verdict: "unknown",
      cause: "invalid-position",
      reason: `FEN を解釈できません（${n.error}）`,
    };
  if (n.opponentInCheck)
    return {
      verdict: "unknown",
      cause: "invalid-position",
      reason: `手番でない側（${COLOR_JA[other(n.sideToMove)]}）のキングがチェックされています。FEN の手番を確認してください`,
    };
  if (request.requiredSideToMove && n.sideToMove !== request.requiredSideToMove)
    return {
      verdict: "unknown",
      cause: "wrong-side-to-move",
      reason: `局面の手番が${COLOR_JA[n.sideToMove]}になっています。違法手の直前に戻した局面は、違反した${COLOR_JA[request.requiredSideToMove]}の手番です`,
    };
  return undefined;
}

/**
 * 保存された手順を検証する。合法に指せて、最後に attacker が相手をメイトし、
 * 途中で 75手ルール（9.6.2）により対局が終わっていない場合だけ、表示用の手順を返す。
 */
export function verifyHelpmateLine(
  port: ChessPositionPort,
  fen: string,
  attacker: PlayerColor,
  moves: string[]
): { ok: true; line: string } | { ok: false; error: string } {
  const replayed = port.replay({ startFen: fen, moves });
  if (!replayed.ok) return { ok: false, error: replayed.error };
  const positions = replayed.fens.map((f) => port.normalize(f));
  const parts: string[] = [];
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    if (!p.ok) return { ok: false, error: p.error };
    const last = i === positions.length - 1;
    // 最後の手がメイトならメイトが優先する（9.6.2）。それより前に 150 半手に達していれば対局は終わっている
    if (!last && p.halfmoveClock >= SEVENTY_FIVE_MOVES_PLIES)
      return {
        ok: false,
        error: "手順の途中で75手ルール（9.6.2）により対局が終了します",
      };
    if (last) {
      if (!p.isCheckmate || p.sideToMove !== other(attacker))
        return { ok: false, error: "手順の最後がメイトになっていません" };
      break;
    }
    const san = replayed.sans[i];
    if (p.sideToMove === "white") parts.push(`${p.fullmoveNumber}. ${san}`);
    else if (i === 0) parts.push(`${p.fullmoveNumber}... ${san}`);
    else parts.push(san);
  }
  return {
    ok: true,
    line:
      parts.length > 0
        ? parts.join(" ")
        : "（入力した局面ですでにチェックメイト。5.1.1 によりその時点で対局は終了しています）",
  };
}

/**
 * 探索結果が、この局面とメイトする側に対するもので、そのまま使えるか。
 * 見つからなかった結果は、同じ版の探索のものだけを使う
 * （時間切れの結果は判定には使い、mateSearchNeeded が次の評価で探し直させる）。
 */
export function searchMatches(
  record: MateSearchRecord | undefined,
  request: MatePositionRequest
): record is MateSearchRecord {
  return (
    record !== undefined &&
    record.fen === request.fen &&
    record.attacker === request.attacker &&
    (record.status === "found" || record.engine === HELPMATE_ENGINE_VERSION)
  );
}

/**
 * メイト可能性を判定する。search は Incident.mateSearch（この局面のものでなければ無視する）。
 */
export function assessMatePossibility(
  port: ChessPositionPort,
  request: MatePositionRequest | undefined,
  search?: MateSearchRecord
): MatePossibility {
  if (!request)
    return {
      verdict: "unknown",
      cause: "no-position",
      reason: "局面が入力されていません",
    };
  const invalid = checkPosition(port, request);
  if (invalid) return invalid;

  const material = materialFromFen(request.fen);
  if (!material.ok)
    return {
      verdict: "unknown",
      cause: "invalid-position",
      reason: `FEN を解釈できません（${material.error}）`,
    };
  const cannot = materialCannotMate(material.material, request.attacker);
  if (cannot) return { verdict: "cannot-mate", reason: cannot };

  if (!searchMatches(search, request))
    return {
      verdict: "unknown",
      cause: "not-searched",
      reason: "局面からメイトの手順を探していません（探索を利用できません）",
    };
  if (search.status !== "found" || !search.moves)
    return {
      verdict: "unknown",
      cause: "not-found",
      reason:
        search.reason === "deadline"
          ? "時間内に局面からメイトの手順を見つけられませんでした（メイト不可能とは限りません。再評価すると探し直します）"
          : "局面からメイトの手順を見つけられませんでした（メイト不可能とは限りません）",
    };
  const verified = verifyHelpmateLine(
    port,
    request.fen,
    request.attacker,
    search.moves
  );
  if (!verified.ok)
    return {
      verdict: "unknown",
      cause: "evidence-invalid",
      reason: `メイトの手順を検証できませんでした（${verified.error}）`,
    };
  return {
    verdict: "can-mate",
    reason: `${COLOR_JA[request.attacker]}がメイトする手順があります: ${verified.line}`,
    line: verified.line,
  };
}

/**
 * ヘルプメイト探索が必要な局面か（局面が正しく、駒の構成では決まらず、使える探索結果がない）。
 * 時間切れで見つからなかった結果は端末の速さに依存するため、評価のたびに探し直す。
 */
export function mateSearchNeeded(
  port: ChessPositionPort,
  incident: Incident
): MatePositionRequest | undefined {
  const request = matePositionRequest(incident);
  if (!request) return undefined;
  const assessed = assessMatePossibility(port, request, incident.mateSearch);
  const timedOut =
    assessed.cause === "not-found" &&
    incident.mateSearch?.reason === "deadline";
  return assessed.cause === "not-searched" || timedOut ? request : undefined;
}
