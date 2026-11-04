import { PlayIcon } from "lucide-react";
import { useRef, useState, useSyncExternalStore } from "react";

import {
  clearCustomNotificationSound,
  readCustomNotificationSoundName,
  subscribeCustomNotificationSound,
  hasNotificationSound,
  NOTIFICATION_MODE_LABELS,
  prepareNotificationMode,
  previewNotificationSound,
  setCustomNotificationSound,
} from "../../threadNotifications";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

/** Only the macOS desktop shell has a Dock, and only it can bounce the icon. */
export function DockBounceSettings() {
  const enabled = useScopedSettings((settings) => settings.dockBounceEnabled);
  const updateSettings = useUpdateScopedSettings();
  if (window.desktopBridge?.getClientPlatform?.() !== "darwin") return null;

  return (
    <SettingsRow
      {...searchableSetting("dock-bounce")}
      description="Keep the Dock icon bouncing while a thread waits on you, until you come back to the app. Needs thread notifications turned on."
      control={
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => updateSettings({ dockBounceEnabled: checked })}
          aria-label="Bounce Dock icon"
        />
      }
    />
  );
}

export function NotificationSettings() {
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const updateSettings = useUpdateScopedSettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  return (
    <SettingsRow
      {...searchableSetting("thread-notifications")}
      description={
        permissionMessage ??
        "System alerts when a thread finishes, fails, or needs input or approval. Applies to this device while RyCode is open."
      }
      control={
        <Select
          value={mode}
          disabled={requesting}
          onValueChange={async (value) => {
            if (
              value !== "off" &&
              value !== "notifications" &&
              value !== "sound" &&
              value !== "notifications-and-sound"
            )
              return;
            setPermissionMessage(null);
            setRequesting(true);
            const permissionMessage = await prepareNotificationMode(value);
            setRequesting(false);
            if (permissionMessage) {
              setPermissionMessage(permissionMessage);
              return;
            }
            updateSettings({ notificationMode: value });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Thread notifications">
            <SelectValue>{NOTIFICATION_MODE_LABELS[mode]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {Object.entries(NOTIFICATION_MODE_LABELS).map(([value, label]) => (
              <SelectItem key={value} hideIndicator value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

/** Lets a device swap both notification sounds for one file the user uploads. */
export function NotificationSoundSettings() {
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const inputRef = useRef<HTMLInputElement>(null);
  // undefined until the stored sound loads, null when using the built-in sounds.
  const soundName = useSyncExternalStore(
    subscribeCustomNotificationSound,
    readCustomNotificationSoundName,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!hasNotificationSound(mode)) return null;

  return (
    <SettingsRow
      {...searchableSetting("notification-sound")}
      description={
        message ??
        (soundName
          ? `Playing ${soundName} for every thread notification on this device.`
          : "Upload any audio file to replace the built-in sounds on this device. Sounds stop after 10 seconds.")
      }
      resetAction={
        soundName ? (
          <SettingResetButton
            label="notification sound"
            disabled={saving}
            onClick={() => {
              setMessage(null);
              void clearCustomNotificationSound().then(
                () => undefined,
                () => setMessage("Couldn't remove the custom sound. Try again."),
              );
            }}
          />
        ) : null
      }
      control={
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            accept="audio/*"
            className="sr-only"
            type="file"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!file) return;
              setMessage(null);
              setSaving(true);
              setCustomNotificationSound(file)
                .then(() => {
                  return previewNotificationSound();
                })
                .catch((error: unknown) => {
                  setMessage(error instanceof Error ? error.message : "Couldn't save that sound.");
                })
                .finally(() => setSaving(false));
            }}
          />
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="Preview notification sound"
            disabled={soundName === undefined}
            onClick={() => void previewNotificationSound()}
          >
            <PlayIcon />
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={() => inputRef.current?.click()}
          >
            {saving ? "Saving…" : soundName ? "Replace sound" : "Upload sound"}
          </Button>
        </div>
      }
    />
  );
}
