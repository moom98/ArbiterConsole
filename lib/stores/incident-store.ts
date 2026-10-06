import { create } from "zustand";
import type { Incident, Decision } from "@/lib/domain/entities";
import { db } from "@/lib/infrastructure/db";
import { DecisionEngine } from "@/lib/domain/decision-engine";

interface IncidentStore {
  // State
  currentIncident: Incident | null;
  currentDecision: Decision | null;
  isProcessing: boolean;
  error: string | null;

  // Actions
  createIncident: (
    gameId: string,
    category: Incident["category"],
    description: string,
    arbiterObserved: boolean
  ) => Promise<void>;

  processIncident: (incidentId: string) => Promise<void>;

  clearCurrentIncident: () => void;

  setError: (error: string | null) => void;
}

export const useIncidentStore = create<IncidentStore>((set, get) => ({
  // Initial state
  currentIncident: null,
  currentDecision: null,
  isProcessing: false,
  error: null,

  // Create new incident
  createIncident: async (gameId, category, description, arbiterObserved) => {
    try {
      set({ isProcessing: true, error: null });

      const incident: Incident = {
        id: crypto.randomUUID(),
        gameId,
        category,
        description,
        arbiterObserved,
        reportedBy: "arbiter",
        reportedAt: new Date(),
        status: "pending",
        escalatedToCA: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Save to DB
      await db.incidents.add(incident);

      set({ currentIncident: incident });

      // Automatically process the incident
      await get().processIncident(incident.id);
    } catch (error) {
      console.error("Failed to create incident:", error);
      set({ error: String(error) });
    } finally {
      set({ isProcessing: false });
    }
  },

  // Process incident through decision engine
  processIncident: async (incidentId) => {
    try {
      set({ isProcessing: true, error: null });

      const incident = await db.incidents.get(incidentId);
      if (!incident) {
        throw new Error("Incident not found");
      }

      // Get game context
      const game = await db.games.get(incident.gameId);
      const tournament = game
        ? await db.tournaments.get(game.tournamentId)
        : null;

      // Count previous incidents for this game
      const previousIncidents = await db.incidents
        .where("gameId")
        .equals(incident.gameId)
        .and((i) => i.category === "illegal-move" && i.id !== incident.id)
        .toArray();

      const playerIncidentHistory = {
        white: previousIncidents.filter(
          (i) => i.description.includes("白") || i.description.includes("white")
        ).length,
        black: previousIncidents.filter(
          (i) => i.description.includes("黒") || i.description.includes("black")
        ).length,
      };

      // Process through decision engine
      const engine = new DecisionEngine();
      const result = await engine.processIncident({
        incident,
        gameContext: game
          ? {
              tournamentId: game.tournamentId,
              gameId: game.id,
              competitionType: tournament?.competitionType || "standard",
              rapidRulesType: tournament?.rapidRulesType,
            }
          : undefined,
        playerIncidentHistory,
      });

      // Save decision
      await db.decisions.add(result.decision);

      // Update incident
      await db.incidents.update(incident.id, {
        status: result.decision.escalationRecommended
          ? "escalated"
          : "resolved",
        decisionId: result.decision.id,
        escalatedToCA: result.decision.escalationRecommended,
        escalationReason: result.decision.escalationReason,
        updatedAt: new Date(),
      });

      set({ currentDecision: result.decision });
    } catch (error) {
      console.error("Failed to process incident:", error);
      set({ error: String(error) });
    } finally {
      set({ isProcessing: false });
    }
  },

  // Clear current incident
  clearCurrentIncident: () => {
    set({ currentIncident: null, currentDecision: null, error: null });
  },

  // Set error
  setError: (error) => {
    set({ error });
  },
}));
