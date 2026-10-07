"use client";

import { useRouter } from "next/navigation";
import { TournamentProfileForm } from "@/components/tournament/TournamentProfileForm";
import { useTournamentStore } from "@/lib/stores/tournament-store";

export default function NewTournamentPage() {
  const router = useRouter();
  const { service, load } = useTournamentStore();

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">大会を作成</h1>
      <TournamentProfileForm
        submitLabel="作成"
        onSubmit={async (input) => {
          const t = await service.saveTournamentProfile(input);
          await load();
          router.push(`/tournament/${encodeURIComponent(t.id)}`);
        }}
        onCancel={() => router.back()}
      />
    </div>
  );
}
