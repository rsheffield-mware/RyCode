import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const UPDATED_AT = "2026-01-01T00:00:00.000Z";
const THREAD_ID = ThreadId.make("thread-1");
const TURN_ID = TurnId.make("turn-1");

const baseThread: OrchestrationThread = {
  id: THREAD_ID,
  projectId: ProjectId.make("project-1"),
  title: "Retry policy",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  pullRequests: [],
  latestTurn: {
    turnId: TURN_ID,
    state: "completed",
    requestedAt: UPDATED_AT,
    startedAt: UPDATED_AT,
    completedAt: UPDATED_AT,
    assistantMessageId: null,
  },
  createdAt: UPDATED_AT,
  updatedAt: UPDATED_AT,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  snoozedUntil: null,
  snoozedAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
};

const readModelWith = (thread: OrchestrationThread): OrchestrationReadModel => ({
  snapshotSequence: 0,
  projects: [],
  threads: [thread],
  updatedAt: UPDATED_AT,
});

const command = {
  type: "thread.reply-suggestion.completed",
  commandId: CommandId.make("cmd-reply-suggestion"),
  threadId: THREAD_ID,
  turnId: TURN_ID,
  suggestion: "Yes, retry on 429 only.",
  expectedLatestUserMessageAt: null,
} as const;

it.layer(NodeServices.layer)("reply suggestion decider", (it) => {
  it.effect("records the suggestion for the turn that just settled", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command,
        readModel: readModelWith(baseThread),
      });
      const event = Array.isArray(result) ? result[0] : result;

      expect(event.type).toBe("thread.reply-suggestion-completed");
      if (event.type === "thread.reply-suggestion-completed") {
        expect(event.payload.turnId).toBe(TURN_ID);
        expect(event.payload.suggestion).toBe("Yes, retry on 429 only.");
      }
    }),
  );

  // A superseded suggestion is rejected rather than turned into a no-op event:
  // every thread event costs a shell refetch and a broadcast to every client.
  it.effect("rejects a second suggestion for a turn that already has one", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: { ...command, commandId: CommandId.make("cmd-reply-suggestion-2") },
        readModel: readModelWith({
          ...baseThread,
          replySuggestion: {
            text: "Ship it.",
            turnId: TURN_ID,
            generatedAt: UPDATED_AT,
          },
        }),
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("rejects a suggestion whose turn is no longer the latest", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command,
        readModel: readModelWith({
          ...baseThread,
          latestTurn: {
            turnId: TurnId.make("turn-2"),
            state: "running",
            requestedAt: UPDATED_AT,
            startedAt: UPDATED_AT,
            completedAt: null,
            assistantMessageId: null,
          },
        }),
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("rejects a suggestion for a turn that did not complete cleanly", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command,
        readModel: readModelWith({
          ...baseThread,
          latestTurn: { ...baseThread.latestTurn!, state: "interrupted" },
        }),
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );
});
