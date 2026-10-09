"use client";

import { useEffect, useRef, useState } from "react";
import {
  canOfferFactPresenceCheck,
  prepareFactPresenceCheck,
  type FactPresenceInput,
  type FactPresenceOutcome,
  type FactPresenceStep,
} from "@/lib/application/fact-presence";
import { ExternalAiSendConfirmation } from "./ExternalAiSendConfirmation";

interface FactPresenceCheckProps {
  input: FactPresenceInput;
  disabled?: boolean;
  /** 判定の結果（質問の並べ方にだけ使う）。較正済みの正しい応答の場合だけ呼ぶ */
  onResult: (
    byQuestion: NonNullable<FactPresenceOutcome["byQuestion"]>
  ) => void;
}

type Pending = Extract<FactPresenceStep, { status: "needs-confirmation" }>;

/**
 * 報告文での記載の有無を AI で確認する（任意。fact-model.md §4, jev-classifier-design §14.3）。
 * - タップされるまで何も通信しない。準備後も送信内容を示し、アービターが確認してから送る（D13）
 * - 結果は質問の並べ方にだけ使う。確認しなくても質問にはそのまま回答できる
 */
export function FactPresenceCheck({
  input,
  disabled,
  onResult,
}: FactPresenceCheckProps) {
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  /** 判定結果で並べ替えた */
  const [applied, setApplied] = useState(false);
  /** 画面を離れた後・新しい要求の後に届いた古い応答を捨てる */
  const requestIdRef = useRef(0);
  useEffect(
    () => () => {
      requestIdRef.current++;
    },
    []
  );

  if (!canOfferFactPresenceCheck(input)) return null;

  const FAILED =
    "記載の確認に失敗しました。並べ替えていません。すべての質問に回答してください";

  const handleOpen = async () => {
    const id = ++requestIdRef.current;
    setLoading(true);
    setNotice(null);
    try {
      const step = await prepareFactPresenceCheck(input);
      if (id !== requestIdRef.current) return;
      if (step.status === "needs-confirmation") setPending(step);
      else
        setNotice(
          step.notice ??
            "記載の確認はできません。すべての質問に回答してください"
        );
    } catch {
      if (id === requestIdRef.current) setNotice(FAILED);
    } finally {
      if (id === requestIdRef.current) setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!pending) return;
    const id = ++requestIdRef.current;
    setLoading(true);
    try {
      const outcome = await pending.send();
      if (id !== requestIdRef.current) return;
      setPending(null);
      setDone(true);
      setNotice(outcome.notice ?? null);
      // 判定できた場合だけ並べ替える（失敗・未較正では「記載なし」とも示さない）
      if (outcome.byQuestion) {
        setApplied(true);
        onResult(outcome.byQuestion);
      }
    } catch {
      if (id !== requestIdRef.current) return;
      setPending(null);
      setDone(true);
      setNotice(FAILED);
    } finally {
      if (id === requestIdRef.current) setLoading(false);
    }
  };

  const handleDecline = () => {
    requestIdRef.current++;
    setPending(null);
    setNotice("外部AIには送信していません。すべての質問に回答してください");
  };

  return (
    <section
      aria-label="報告文の記載の確認"
      className="rounded-lg border border-gray-200 p-3 text-sm"
    >
      {!pending && !done && (
        <button
          type="button"
          onClick={() => void handleOpen()}
          disabled={disabled || loading}
          className="w-full min-h-12 px-4 rounded-lg border-2 border-gray-300 bg-white font-semibold text-gray-800 disabled:opacity-40"
        >
          {loading ? "準備中..." : "AIで報告文の記載を確認（任意）"}
        </button>
      )}
      {!pending && !done && !notice && (
        <p className="mt-1 text-xs text-gray-600">
          報告文に書かれていない事実の質問を先に並べます。確認しなくても回答できます。
        </p>
      )}
      {pending && (
        <ExternalAiSendConfirmation
          preview={pending.preview}
          onConfirm={() => void handleSend()}
          onDecline={handleDecline}
          disabled={disabled || loading}
          confirmLabel="確認して記載を確認"
        />
      )}
      {applied && (
        <p role="status" className="text-gray-700">
          記載の確認に合わせて質問を並べ替えました。回答はアービターが選んでください。
        </p>
      )}
      {notice && (
        <p role="status" className="mt-1 text-xs text-gray-600">
          {notice}
        </p>
      )}
    </section>
  );
}
