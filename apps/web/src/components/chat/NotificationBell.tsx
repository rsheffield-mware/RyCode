import type { ClientSettings } from "@t3tools/contracts/settings";
import { BellIcon, BellOffIcon } from "lucide-react";
import { useState } from "react";

import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { NOTIFICATION_MODE_LABELS, prepareNotificationMode } from "~/threadNotifications";
import { Button } from "../ui/button";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";

type NotificationMode = ClientSettings["notificationMode"];

export function NotificationBell() {
  const mode = useClientSettings((settings) => settings.notificationMode);
  const updateSettings = useUpdateClientSettings();
  const [requesting, setRequesting] = useState(false);

  const selectMode = async (value: string) => {
    if (!(value in NOTIFICATION_MODE_LABELS) || requesting) return;
    const nextMode = value as NotificationMode;
    setRequesting(true);
    try {
      const message = await prepareNotificationMode(nextMode);
      if (message) {
        toastManager.add({
          type: "warning",
          title: "Notifications not enabled",
          description: message,
        });
        return;
      }
      await updateSettings({ notificationMode: nextMode });
    } finally {
      setRequesting(false);
    }
  };

  return (
    <Menu>
      <MenuTrigger
        disabled={requesting}
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Thread notifications: ${NOTIFICATION_MODE_LABELS[mode]}`}
            title={`Thread notifications: ${NOTIFICATION_MODE_LABELS[mode]}`}
          />
        }
      >
        {mode === "off" ? <BellOffIcon aria-hidden="true" /> : <BellIcon aria-hidden="true" />}
      </MenuTrigger>
      <MenuPopup align="end" aria-label="Thread notifications">
        <MenuRadioGroup value={mode} onValueChange={(value) => void selectMode(value)}>
          {Object.entries(NOTIFICATION_MODE_LABELS).map(([value, label]) => (
            <MenuRadioItem key={value} value={value}>
              {label}
              <MenuRadioItemIndicator />
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
