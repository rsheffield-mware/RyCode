import type { EnvironmentId } from "@t3tools/contracts";
import { FolderGit2Icon } from "lucide-react";
import { memo } from "react";
import { shellEnvironment } from "~/state/shell";
import { useAtomCommand } from "~/state/use-atom-command";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "./threadDetailsPanelStyles";

export const SourcetreeButton = memo(function SourcetreeButton({
  environmentId,
  cwd,
}: {
  environmentId: EnvironmentId;
  cwd: string;
}) {
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, "open in Sourcetree");

  return (
    <ThreadDetailsControl
      size="sm"
      variant="ghost"
      onClick={() => {
        void openInEditor({ environmentId, input: { cwd, editor: "sourcetree" } });
      }}
    >
      <FolderGit2Icon aria-hidden="true" className={THREAD_DETAILS_PANEL_ICON_CLASS} />
      <span className={THREAD_DETAILS_PANEL_LABEL_CLASS}>Open in Sourcetree</span>
    </ThreadDetailsControl>
  );
});
