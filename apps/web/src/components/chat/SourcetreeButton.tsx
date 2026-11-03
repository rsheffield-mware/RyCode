import type { EnvironmentId } from "@t3tools/contracts";
import { FolderGit2Icon } from "lucide-react";
import { memo } from "react";
import { Button } from "../ui/button";
import { MenuItem, MenuItemLabel } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { shellEnvironment } from "~/state/shell";
import { useAtomCommand } from "~/state/use-atom-command";

export const SourcetreeButton = memo(function SourcetreeButton({
  environmentId,
  cwd,
  presentation = "toolbar",
}: {
  environmentId: EnvironmentId;
  cwd: string;
  presentation?: "toolbar" | "menu";
}) {
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, "open in Sourcetree");
  const open = () => {
    void openInEditor({ environmentId, input: { cwd, editor: "sourcetree" } });
  };

  if (presentation === "menu") {
    return (
      <MenuItem density="touch" onClick={open}>
        <FolderGit2Icon className="size-4" />
        <MenuItemLabel>Open in Sourcetree</MenuItemLabel>
      </MenuItem>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button aria-label="Open in Sourcetree" size="icon-xs" variant="outline" onClick={open} />
        }
      >
        <FolderGit2Icon aria-hidden="true" className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">Open in Sourcetree</TooltipPopup>
    </Tooltip>
  );
});
