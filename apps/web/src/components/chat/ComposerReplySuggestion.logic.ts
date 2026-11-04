import type { OrchestrationV2AppThread } from "@t3tools/contracts";

export interface ComposerReplySuggestionInput {
  /** The routed thread's suggestion, or null/undefined when it has none. */
  readonly suggestion: OrchestrationV2AppThread["replySuggestion"];
  /** False on servers too old to generate suggestions. */
  readonly supported: boolean;
  /** Resolved for the thread's project, matching how the server gates generation. */
  readonly enabled: boolean;
  /** Turn whose suggestion the user already accepted or dismissed on this client. */
  readonly consumedTurnId: string | null;
  readonly phase: string;
  /** An approval, a pending question, or a plan follow-up owns the composer. */
  readonly composerIsClaimed: boolean;
  /** Length of the composer's text. */
  readonly promptLength: number;
  /** Staged attachments, terminal contexts and other chips behind the prompt. */
  readonly contextRecordCount: number;
}

export function resolveComposerReplySuggestion(input: ComposerReplySuggestionInput): string | null {
  if (!input.supported || !input.enabled || input.composerIsClaimed) return null;
  if (input.phase === "running" || input.phase === "connecting") return null;
  if (input.promptLength > 0 || input.contextRecordCount > 0) return null;
  const suggestion = input.suggestion;
  if (!suggestion || suggestion.turnId === input.consumedTurnId) return null;
  const text = suggestion.text.trim();
  return text.length > 0 ? text : null;
}

export interface ReplySuggestionTabInput {
  readonly shiftKey: boolean;
  readonly isComposing: boolean;
  /** Whatever `resolveComposerReplySuggestion` returned. */
  readonly suggestion: string | null;

  readonly livePrompt: string;
}

/** Tab accepts only in the exact state that shows the suggestion. */
export function shouldAcceptReplySuggestionOnTab(input: ReplySuggestionTabInput): boolean {
  if (input.shiftKey || input.isComposing) return false;
  if (input.suggestion === null) return false;
  return input.livePrompt.length === 0;
}
