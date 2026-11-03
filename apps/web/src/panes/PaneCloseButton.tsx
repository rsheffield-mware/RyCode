/**
 * Closes the pane it is rendered in. Renders nothing in the single-pane app,
 * which is what keeps it inert on the default path.
 */
import { XIcon } from "lucide-react";

import { Button } from "../components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { usePane } from "./PaneContext";
import { useChatPaneActions } from "./usePanes";

export function PaneCloseButton() {
  const { paneId, paneCount } = usePane();
  const { closePane } = useChatPaneActions();
  if (paneCount <= 1) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label="Close pane"
            onClick={() => closePane(paneId)}
            size="icon-xs"
            variant="ghost-muted"
          >
            <XIcon aria-hidden />
          </Button>
        }
      />
      <TooltipPopup side="bottom">Close pane</TooltipPopup>
    </Tooltip>
  );
}
