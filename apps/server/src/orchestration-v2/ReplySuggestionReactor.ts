import {
  CommandId,
  type OrchestrationV2DomainEvent,
  type ThreadId,
  type RunId,
} from "@t3tools/contracts";
import { formatThreadTitleContext } from "@t3tools/provider-core/server/threadTitleContext";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

export class ReplySuggestionReactor extends Context.Service<
  ReplySuggestionReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly handle: (event: OrchestrationV2DomainEvent) => Effect.Effect<void>;
  }
>()("t3/orchestration-v2/ReplySuggestionReactor") {}

export const layer = Layer.effect(
  ReplySuggestionReactor,
  Effect.gen(function* () {
    const engine = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const projects = yield* ProjectStore.ProjectStoreV2;
    const settingsService = yield* ServerSettings.ServerSettingsService;
    const textGeneration = yield* TextGeneration.TextGeneration;

    const handle: ReplySuggestionReactor["Service"]["handle"] = Effect.fn(
      "ReplySuggestionReactor.handle",
    )(
      function* (event) {
        if (event.type !== "run.updated" || event.payload.status !== "completed") return;
        const thread = yield* projections.getThread(event.threadId);
        const settings = resolveProjectSettings(
          yield* settingsService.getSettings,
          thread.projectId,
        ).settings;
        if (!settings.replySuggestionsEnabled) return;
        const projection = yield* projections.getThreadRecords(event.threadId, [
          "messages",
          "runs",
          "runtimeRequests",
        ]);
        const latest = projection.runs.toSorted((a, b) => b.ordinal - a.ordinal)[0];
        if (
          latest?.id !== event.payload.id ||
          latest.status !== "completed" ||
          projection.thread.archivedAt !== null ||
          projection.thread.deletedAt !== null ||
          projection.thread.replySuggestion?.turnId === latest.id ||
          projection.runtimeRequests.some((request) => request.status === "pending")
        )
          return;
        const latestUserMessage = projection.messages
          .filter((message) => message.role === "user")
          .at(-1);
        if (latestUserMessage === undefined) return;
        const project = yield* projects.get(projection.thread.projectId);
        if (Option.isNone(project)) return;
        const { message: transcript } = formatThreadTitleContext(
          projection.messages.filter((message) => !message.streaming),
        );
        if (transcript.trim() === "") return;
        const result = yield* textGeneration.generateReplySuggestion({
          cwd: projection.thread.worktreePath ?? project.value.workspaceRoot,
          transcript,
          modelSelection: settings.textGenerationModelSelection,
        });
        const currentSettings = resolveProjectSettings(
          yield* settingsService.getSettings,
          projection.thread.projectId,
        ).settings;
        if (!currentSettings.replySuggestionsEnabled) return;
        yield* engine.dispatch({
          type: "thread.reply-suggestion.complete",
          commandId: CommandId.make(`rycode:reply-suggestion:${event.payload.id}`),
          threadId: event.threadId,
          sourceMessageId: latestUserMessage.id,
          suggestion: {
            turnId: event.payload.id,
            text: result.suggestion,
            generatedAt: DateTime.formatIso(yield* DateTime.now),
          },
        });
      },
      Effect.catchCause((cause) =>
        Effect.logWarning("Reply suggestion generation failed", { cause }),
      ),
    );

    const start = Effect.fn("ReplySuggestionReactor.start")(function* () {
      const inFlight = yield* FiberMap.make<ThreadId>();
      const runs = new Map<ThreadId, RunId>();
      yield* forkParked(
        Stream.runForEach(engine.streamDomainEvents, (event) => {
          if (event.type !== "run.updated" || event.payload.status !== "completed")
            return Effect.void;
          if (runs.get(event.threadId) === event.payload.id) return Effect.void;
          runs.set(event.threadId, event.payload.id);
          return handle(event).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                if (runs.get(event.threadId) === event.payload.id) runs.delete(event.threadId);
              }),
            ),
            FiberMap.run(inFlight, event.threadId),
            Effect.asVoid,
          );
        }),
      );
    });
    return { start, handle } satisfies ReplySuggestionReactor["Service"];
  }),
);
