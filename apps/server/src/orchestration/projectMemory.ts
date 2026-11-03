const MAX_PROJECT_MEMORY_LENGTH = 4_000;

/** Add user-curated project context without changing the message kept in the thread. */
export function withProjectMemory(message: string, memory: string): string {
  if (message.trimStart().startsWith("/")) return message;
  const selected = memory.trim().slice(0, MAX_PROJECT_MEMORY_LENGTH);
  if (!selected) return message;
  return `<rycode_project_memory>\n${selected}\n</rycode_project_memory>\n\n${message}`;
}
