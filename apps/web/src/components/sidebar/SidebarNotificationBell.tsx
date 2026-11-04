import type { ClientSettings } from "@t3tools/contracts/settings";
import { BellIcon, BellOffIcon } from "lucide-react";
import { useState } from "react";

import { useClientSettings, updateClientSettings } from "~/hooks/useSettings";
import { NOTIFICATION_MODE_LABELS, prepareNotificationMode } from "~/threadNotifications";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from "../ui/menu";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { toastManager } from "../ui/toast";

type NotificationMode = ClientSettings["notificationMode"];

async function applyNotificationMode(mode: NotificationMode) {
  const message = await prepareNotificationMode(mode);
  if (message) {
    toastManager.add({
      type: "warning",
      title: "Notifications not enabled",
      description: message,
    });
    return;
  }
  await updateClientSettings({ notificationMode: mode });
}

export function SidebarNotificationBell() {
  const mode = useClientSettings((settings) => settings.notificationMode);
  const [requesting, setRequesting] = useState(false);

  const selectMode = (value: string) => {
    if (!(value in NOTIFICATION_MODE_LABELS) || requesting) return;
    setRequesting(true);
    void applyNotificationMode(value as NotificationMode).finally(() => setRequesting(false));
  };

  return (
    <SidebarMenuItem className="shrink-0">
      <Menu>
        <MenuTrigger
          disabled={requesting}
          render={
            <SidebarMenuButton
              size="icon"
              aria-label={`Thread notifications: ${NOTIFICATION_MODE_LABELS[mode]}`}
              title={`Thread notifications: ${NOTIFICATION_MODE_LABELS[mode]}`}
            />
          }
        >
          {mode === "off" ? <BellOffIcon aria-hidden="true" /> : <BellIcon aria-hidden="true" />}
        </MenuTrigger>
        <MenuPopup side="top" align="start" aria-label="Thread notifications">
          <MenuRadioGroup value={mode} onValueChange={selectMode}>
            {Object.entries(NOTIFICATION_MODE_LABELS).map(([value, label]) => (
              <MenuRadioItem key={value} value={value}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1">{label}</span>
                  <MenuRadioItemIndicator />
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>
    </SidebarMenuItem>
  );
}
