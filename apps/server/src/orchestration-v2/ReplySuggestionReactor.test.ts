import { assert, it, vi } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  NodeId,
  type OrchestrationV2DomainEvent,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EventSink from "./EventSink.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ReplySuggestionReactor from "./ReplySuggestionReactor.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

const threadId = ThreadId.make("thread:reply-suggestion");
const projectId = ProjectId.make("project:reply-suggestion");
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for suggestion tests"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

function makeHarness(enabled = true) {
  const database = SqlitePersistence.layerMemory;
  const orchestrator = ProviderReplayHarness.layerWithRegistry(
    { name: "reply-suggestions" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: database, runEffectWorker: false },
  );
  const stores = Layer.mergeAll(orchestrator, ProjectionStore.layer.pipe(Layer.provide(database)));
  const generateReplySuggestion = vi.fn(() => Effect.succeed({ suggestion: "Run the tests" }));
  const reactor = ReplySuggestionReactor.layer.pipe(
    Layer.provide(stores),
    Layer.provide(ServerSettings.layerTest({ replySuggestionsEnabled: enabled })),
    Layer.provide(Layer.mock(TextGeneration.TextGeneration)({ generateReplySuggestion })),
    Layer.provide(
      Layer.mock(ProjectStore.ProjectStoreV2)({
        get: () =>
          Effect.succeedSome({
            projectId,
            title: "Project",
            workspaceRoot: "/repo",
            defaultModelSelection: modelSelection,
            defaultThreadEnvMode: null,
            autoPull: false,
            faviconPath: null,
            projectIcon: null,
            scripts: [],
            pinnedAt: null,
            archivedAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            deletedAt: null,
          }),
      }),
    ),
  );
  return { layer: Layer.mergeAll(stores, reactor), generateReplySuggestion };
}

const createThread = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  yield* orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make("create:reply-suggestion"),
    threadId,
    projectId,
    title: "Reply suggestion",
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: "/repo/worktree",
    createdBy: "user",
    creationSource: "web",
  });
});

const addUserMessage = Effect.fn("test.addUserMessage")(function* (id: string) {
  const sink = yield* EventSink.EventSinkV2;
  const now = yield* DateTime.now;
  yield* sink.write({
    events: [
      {
        id: EventId.make(`event:${id}`),
        type: "message.updated",
        threadId,
        occurredAt: now,
        payload: {
          id: MessageId.make(id),
          threadId,
          runId: RunId.make("run:first"),
          nodeId: null,
          role: "user",
          text: id,
          attachments: [],
          streaming: false,
          createdBy: "user",
          creationSource: "web",
          createdAt: now,
          updatedAt: now,
        },
      },
    ],
  });
});

const completeRun = Effect.fn("test.completeRun")(function* (ordinal = 1) {
  const sink = yield* EventSink.EventSinkV2;
  const now = yield* DateTime.now;
  const event = {
    id: EventId.make(`event:run:${ordinal}`),
    type: "run.updated",
    threadId,
    occurredAt: now,
    payload: {
      id: RunId.make(`run:${ordinal}`),
      threadId,
      ordinal,
      providerInstanceId: instanceId,
      modelSelection,
      providerThreadId: null,
      userMessageId: MessageId.make("message:first"),
      rootNodeId: null,
      activeAttemptId: null,
      status: "completed",
      requestedAt: now,
      startedAt: now,
      completedAt: now,
      checkpointId: null,
      contextHandoffId: null,
    },
  } satisfies OrchestrationV2DomainEvent;
  yield* sink.write({ events: [event] });
  return event;
});

it.effect.each([false, true])("generates a reply only when enabled (%s)", (enabled) => {
  const harness = makeHarness(enabled);
  return Effect.gen(function* () {
    yield* createThread;
    yield* addUserMessage("message:first");
    const event = yield* completeRun();
    const reactor = yield* ReplySuggestionReactor.ReplySuggestionReactor;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    yield* reactor.handle(event);
    const suggestion = (yield* projections.getThread(threadId)).replySuggestion;
    assert.equal(harness.generateReplySuggestion.mock.calls.length, enabled ? 1 : 0);
    assert.equal(suggestion?.text ?? null, enabled ? "Run the tests" : null);
    if (enabled) {
      assert.equal(suggestion?.turnId, event.payload.id);
      yield* reactor.handle(event);
      assert.equal(harness.generateReplySuggestion.mock.calls.length, 1);
      yield* addUserMessage("message:accepted-reply");
      assert.equal((yield* projections.getThread(threadId)).replySuggestion, null);
    }
  }).pipe(Effect.provide(harness.layer));
});

it.effect.each(["pending-question", "newer-run"] as const)(
  "suppresses replies for %s",
  (reason) => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      yield* createThread;
      yield* addUserMessage("message:first");
      const event = yield* completeRun();
      if (reason === "newer-run") yield* completeRun(2);
      else {
        const sink = yield* EventSink.EventSinkV2;
        const now = yield* DateTime.now;
        yield* sink.write({
          events: [
            {
              id: EventId.make("event:question"),
              type: "runtime-request.updated",
              threadId,
              occurredAt: now,
              payload: {
                id: RuntimeRequestId.make("question"),
                nodeId: NodeId.make("node:question"),
                providerTurnId: null,
                nativeRequestRef: null,
                kind: "user_input",
                status: "pending",
                responseCapability: { type: "message" },
                createdAt: now,
                resolvedAt: null,
              },
            },
          ],
        });
      }
      const reactor = yield* ReplySuggestionReactor.ReplySuggestionReactor;
      yield* reactor.handle(event);
      assert.equal(harness.generateReplySuggestion.mock.calls.length, 0);
    }).pipe(Effect.provide(harness.layer));
  },
);

it.effect("rejects a generated reply when another user message arrived without a new run", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    yield* createThread;
    yield* addUserMessage("message:first");
    const event = yield* completeRun();
    yield* addUserMessage("message:newer");
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    yield* orchestrator.dispatch({
      type: "thread.reply-suggestion.complete",
      commandId: CommandId.make("reply:stale"),
      threadId,
      sourceMessageId: MessageId.make("message:first"),
      suggestion: {
        turnId: event.payload.id,
        text: "Stale suggestion",
        generatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    assert.equal((yield* projections.getThread(threadId)).replySuggestion ?? null, null);
  }).pipe(Effect.provide(harness.layer));
});
