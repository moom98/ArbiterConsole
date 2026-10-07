"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type {
  Game,
  PlayerProfile,
  Round,
  Tournament,
} from "@/lib/domain/entities";
import { useTournamentStore } from "@/lib/stores/tournament-store";
import { TournamentProfileForm } from "@/components/tournament/TournamentProfileForm";
import { RoundBoards } from "@/components/tournament/RoundBoards";
import {
  formatRulesetSummary,
  toProfileInput,
} from "@/lib/domain/services/tournament-profile";
import {
  nextRoundStatus,
  parseBoardRange,
  ROUND_STATUS_LABEL,
} from "@/lib/domain/services/round-planning";
import {
  opponentTimePenalty,
  tournamentPenaltyNote,
} from "@/lib/domain/rules/time-penalty";

type Notice = { kind: "success" | "error"; text: string } | null;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const STATUS_ACTION: Record<"active" | "completed", string> = {
  active: "ラウンド開始",
  completed: "ラウンド終了",
};

/** 大会の設定・ラウンド・ボード・プレーヤー */
export default function TournamentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params?.id ?? "");
  const router = useRouter();
  const { service, active, setActive, load } = useTournamentStore();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [players, setPlayers] = useState<PlayerProfile[]>([]);
  const [incidentCount, setIncidentCount] = useState(0);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const [roundInput, setRoundInput] = useState("");
  const [boardsInput, setBoardsInput] = useState("1-40");
  const [openRound, setOpenRound] = useState<number | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [playerName, setPlayerName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const reload = useCallback(async () => {
    const all = await service.listTournaments();
    const t = all.find((x) => x.id === id) ?? null;
    setTournament(t);
    setNotFound(t === null);
    if (!t) return;
    const [r, p, n] = await Promise.all([
      service.listRounds(t.id),
      service.listPlayers(t.id),
      service.countIncidents(t.id),
    ]);
    setRounds(r);
    setPlayers(p);
    setIncidentCount(n);
  }, [id, service]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!tournament || openRound === null) {
      setGames([]);
      return;
    }
    void service.listGames(tournament.id, openRound).then(setGames);
  }, [tournament, openRound, service]);

  const run = async (fn: () => Promise<string | void>) => {
    setNotice(null);
    try {
      const text = await fn();
      if (text) setNotice({ kind: "success", text });
      await reload();
      await load();
    } catch (e) {
      setNotice({ kind: "error", text: message(e) });
    }
  };

  if (notFound) {
    return (
      <div className="p-4 sm:p-6">
        <p className="mb-4">大会が見つかりません。</p>
        <Link href="/tournament" className="text-blue-700 underline">
          大会一覧へ
        </Link>
      </div>
    );
  }
  if (!tournament) return <div className="p-4">読み込み中...</div>;

  const isActive = active?.id === tournament.id;
  const nextRoundNumber =
    rounds.length > 0 ? Math.max(...rounds.map((r) => r.roundNumber)) + 1 : 1;
  const boardRange = parseBoardRange(boardsInput);
  const roundNumber = Number(roundInput || nextRoundNumber);
  const b2Rule = opponentTimePenalty(
    tournament.competitionType,
    tournament.supervisionRegime,
    tournament.overrides
  );

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <Link
          href="/tournament"
          className="inline-flex items-center min-h-12 text-sm text-blue-700 underline"
        >
          大会一覧
        </Link>
        <h1 className="text-2xl font-bold">{tournament.name}</h1>
        <p className="text-gray-700">{formatRulesetSummary(tournament)}</p>
        {b2Rule.kind === "tournament" && (
          <p className="text-sm text-gray-700">
            {tournamentPenaltyNote(b2Rule)}
          </p>
        )}
        {!isActive ? (
          <button
            type="button"
            onClick={() => void setActive(tournament.id)}
            className="mt-2 w-full min-h-12 px-4 bg-blue-600 text-white rounded-lg font-semibold"
          >
            この大会を選択
          </button>
        ) : (
          <p className="mt-2 text-sm font-semibold text-blue-700">
            選択中の大会
          </p>
        )}
      </div>

      {notice && (
        <p
          role="status"
          className={`p-3 rounded text-sm ${
            notice.kind === "success"
              ? "bg-green-50 text-green-800"
              : "bg-red-50 text-red-700"
          }`}
        >
          {notice.text}
        </p>
      )}

      <section className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold mb-3">ラウンド・ボード</h2>
        <div className="grid grid-cols-[5rem_1fr] gap-2 items-end">
          <label className="block text-sm font-semibold">
            ラウンド
            <input
              type="number"
              inputMode="numeric"
              min={1}
              placeholder={String(nextRoundNumber)}
              value={roundInput}
              onChange={(e) => setRoundInput(e.target.value)}
              className="mt-1 w-full min-h-12 px-2 border border-gray-300 rounded-lg"
            />
          </label>
          <label className="block text-sm font-semibold">
            ボード（例: 1-40）
            <input
              type="text"
              inputMode="numeric"
              value={boardsInput}
              onChange={(e) => setBoardsInput(e.target.value)}
              className="mt-1 w-full min-h-12 px-2 border border-gray-300 rounded-lg"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={
            !boardRange || !Number.isInteger(roundNumber) || roundNumber < 1
          }
          onClick={() =>
            void run(async () => {
              const { added } = await service.createRoundWithBoards(
                tournament.id,
                roundNumber,
                boardRange!
              );
              setRoundInput("");
              setOpenRound(roundNumber);
              return `Round ${roundNumber}: ${added}ボードを追加しました`;
            })
          }
          className="mt-2 w-full min-h-12 px-4 bg-blue-600 text-white rounded-lg font-semibold disabled:bg-gray-300"
        >
          Round {Number.isInteger(roundNumber) ? roundNumber : "?"}
          {boardRange
            ? `, boards ${boardRange.from}–${boardRange.to}`
            : ""}{" "}
          を作成
        </button>

        <ul className="mt-4 space-y-2">
          {rounds.map((r) => {
            const next = nextRoundStatus(r.status);
            return (
              <li key={r.id} className="border-t pt-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-expanded={openRound === r.roundNumber}
                    onClick={() =>
                      setOpenRound(
                        openRound === r.roundNumber ? null : r.roundNumber
                      )
                    }
                    className="flex-1 min-h-12 text-left font-semibold"
                  >
                    Round {r.roundNumber}
                    <span className="ml-2 text-sm font-normal text-gray-600">
                      {ROUND_STATUS_LABEL[r.status]}
                    </span>
                  </button>
                  {next && (
                    <button
                      type="button"
                      onClick={() =>
                        void run(async () => {
                          await service.changeRoundStatus(r.id, next);
                        })
                      }
                      className="min-h-12 px-3 border border-blue-600 text-blue-700 rounded-lg"
                    >
                      {STATUS_ACTION[next as "active" | "completed"]}
                    </button>
                  )}
                </div>
                {openRound === r.roundNumber && (
                  <div className="mt-2">
                    <RoundBoards
                      key={games.map((g) => g.id).join("|")}
                      games={games}
                      players={players}
                      onAssign={async (gameId, names) => {
                        await service.assignPlayers(gameId, names);
                        setPlayers(await service.listPlayers(tournament.id));
                      }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold mb-3">プレーヤー</h2>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await service.addPlayer(tournament.id, { name: playerName });
              setPlayerName("");
            });
          }}
        >
          <input
            type="text"
            aria-label="プレーヤー名"
            placeholder="プレーヤー名"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="flex-1 min-w-0 min-h-12 px-3 border border-gray-300 rounded-lg"
          />
          <button
            type="submit"
            disabled={!playerName.trim()}
            className="min-h-12 px-4 bg-blue-600 text-white rounded-lg disabled:bg-gray-300"
          >
            追加
          </button>
        </form>
        <ul className="mt-3 divide-y">
          {players.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-1">
              <span>
                {p.name}
                {p.rating ? (
                  <span className="ml-2 text-sm text-gray-600">{p.rating}</span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() =>
                  void run(async () => {
                    await service.removePlayer(p.id);
                  })
                }
                className="min-h-12 px-3 text-sm text-red-700"
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">大会プロファイル</h2>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="min-h-12 px-3 text-blue-700 underline"
            >
              編集
            </button>
          )}
        </div>
        {editing ? (
          <div className="mt-3">
            {incidentCount > 0 && (
              <p
                role="note"
                className="mb-3 p-3 bg-yellow-50 border border-yellow-300 rounded text-sm text-yellow-900"
              >
                この大会には{incidentCount}
                件のIncidentが記録されています。変更（競技区分・適用規則・規則バージョン・大会規定の上書き）は今後の報告にのみ適用され、記録済み・回答待ちのIncidentは報告時の規則セットで判断されます。
              </p>
            )}
            <TournamentProfileForm
              initial={toProfileInput(tournament)}
              submitLabel="保存"
              onSubmit={async (input) => {
                await service.saveTournamentProfile(input, tournament.id);
                setEditing(false);
                await reload();
                await load();
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <dl className="mt-2 text-sm grid grid-cols-[7rem_1fr] gap-y-1">
            <dt className="text-gray-600">期間</dt>
            <dd>
              {new Date(tournament.startDate).toLocaleDateString("ja-JP")}
              {tournament.endDate
                ? ` – ${new Date(tournament.endDate).toLocaleDateString("ja-JP")}`
                : ""}
            </dd>
            <dt className="text-gray-600">会場</dt>
            <dd>{tournament.venue ?? "—"}</dd>
            <dt className="text-gray-600">Chief Arbiter</dt>
            <dd>{tournament.chiefArbiter ?? "—"}</dd>
            <dt className="text-gray-600">ラウンド数</dt>
            <dd>{tournament.totalRounds ?? "—"}</dd>
          </dl>
        )}
        <Link
          href="/settings"
          className="mt-3 inline-flex items-center min-h-12 text-blue-700 underline"
        >
          大会特別規定（PDF）を登録する（設定）
        </Link>
      </section>

      <section className="bg-white rounded-lg shadow p-4">
        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="w-full min-h-12 px-4 text-red-700 border border-red-200 rounded-lg"
          >
            大会を削除
          </button>
        ) : (
          <div className="p-3 bg-red-50 rounded-lg">
            <p className="mb-2 text-red-800">
              大会・ラウンド・プレーヤー・大会特別規定を削除します。Incidentが記録されている大会は削除できません。
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  void (async () => {
                    try {
                      await service.deleteTournament(tournament.id);
                      const { deleteTournamentRuleSources } =
                        await import("@/lib/application/rule-library");
                      await deleteTournamentRuleSources(tournament.id);
                      await load();
                      router.push("/tournament");
                    } catch (e) {
                      setConfirmDelete(false);
                      setNotice({ kind: "error", text: message(e) });
                    }
                  })()
                }
                className="flex-1 min-h-12 px-3 bg-red-600 text-white rounded-lg"
              >
                削除する
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="flex-1 min-h-12 px-3 bg-gray-100 rounded-lg"
              >
                キャンセル
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
