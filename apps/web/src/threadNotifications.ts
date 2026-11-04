import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ClientSettings } from "@t3tools/contracts/settings";

import completionUrl from "./assets/notification-completion.mp3";
import inputUrl from "./assets/notification-input.mp3";

type NotificationMode = ClientSettings["notificationMode"];
export const NOTIFICATION_MODE_LABELS = {
  off: "Off",
  notifications: "Notifications only",
  sound: "Sound only",
  "notifications-and-sound": "Notifications with sound",
} satisfies Record<NotificationMode, string>;

export function hasNotificationSound(mode: NotificationMode) {
  return mode === "sound" || mode === "notifications-and-sound";
}

export function hasDesktopNotifications(mode: NotificationMode) {
  return mode === "notifications" || mode === "notifications-and-sound";
}

const TAG_HASH_OFFSET_BASIS = 0xcbf29ce484222325n;
const TAG_HASH_PRIME = 0x100000001b3n;
const TAG_HASH_MASK = 0xffffffffffffffffn;

/** Windows drops toast notifications with the 73-character environment/thread tag. */
export function threadNotificationTag(environmentId: EnvironmentId, threadId: ThreadId): string {
  const key = `${environmentId}:${threadId}`;
  let hash = TAG_HASH_OFFSET_BASIS;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= BigInt(key.charCodeAt(index));
    hash = (hash * TAG_HASH_PRIME) & TAG_HASH_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Check device permission before persisting a mode that shows system alerts. */
export async function prepareNotificationMode(mode: NotificationMode): Promise<string | null> {
  if (hasNotificationSound(mode)) unlockNotificationAudio();
  if (!hasDesktopNotifications(mode)) return null;
  if (typeof Notification === "undefined" || !window.isSecureContext) {
    return "Notifications need a supported browser over HTTPS, or the desktop app. Sound only is still available.";
  }
  try {
    if ((await Notification.requestPermission()) === "granted") return null;
    return "Allow notifications in your browser or system settings, then choose this option again. Sound only is still available.";
  } catch {
    return "Notifications are unavailable in this browser. Sound only is still available.";
  }
}

let originalFavicon: HTMLLinkElement | undefined;
let badgeFavicon: HTMLLinkElement | undefined;

export function setNotificationBadge(count: number, bounce = false) {
  const bridge = window.desktopBridge;
  let image: string | null = null;
  if (count > 0 && (!bridge || bridge.getClientPlatform() === "win32")) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#e5484d";
      context.beginPath();
      context.arc(32, 32, 28, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "white";
      context.font = `600 ${count > 9 ? 30 : 40}px "Segoe UI", sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(count > 9 ? "9+" : String(count), 32, 34);
      image = canvas.toDataURL("image/png");
    }
  }
  if (!bridge) {
    if (image) {
      if (!badgeFavicon) {
        originalFavicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? undefined;
        badgeFavicon = document.createElement("link");
        badgeFavicon.rel = "icon";
        badgeFavicon.type = "image/png";
        badgeFavicon.sizes.value = "64x64";
        originalFavicon?.remove();
        document.head.append(badgeFavicon);
      }
      badgeFavicon.href = image;
    } else if (badgeFavicon) {
      badgeFavicon.remove();
      badgeFavicon = undefined;
      if (originalFavicon) document.head.append(originalFavicon);
      originalFavicon = undefined;
    }
  }
  void bridge?.setNotificationBadge({ count, image, bounce }).catch(() => undefined);
}

let audioContext: AudioContext | undefined;
const buffers = new Map<string, Promise<AudioBuffer>>();
/** When each sound's current playback ends, on the audio context's clock. */
const playingUntil = new Map<string, number>();

// Custom sounds are device-local, like the notification mode, so the bytes never ride settings sync.
const SOUND_DATABASE_NAME = "t3code:notification-sound";
const SOUND_STORE_NAME = "sounds";
const CUSTOM_SOUND_KEY = "custom";
export const MAX_CUSTOM_NOTIFICATION_SOUND_BYTES = 5 * 1024 * 1024;
// Long uploads such as songs are cut off so an alert never plays for minutes.
const MAX_NOTIFICATION_SOUND_SECONDS = 10;

export interface CustomNotificationSound {
  readonly name: string;
  readonly blob: Blob;
}

let soundDatabase: Promise<IDBDatabase> | undefined;
let customSound: Promise<CustomNotificationSound | undefined> | undefined;
let customSoundName: string | null | undefined;
const soundListeners = new Set<() => void>();

function publishCustomSound(sound: CustomNotificationSound | undefined) {
  customSoundName = sound?.name ?? null;
  for (const listener of soundListeners) listener();
}

export function readCustomNotificationSoundName() {
  return customSoundName;
}

export function subscribeCustomNotificationSound(listener: () => void) {
  soundListeners.add(listener);
  void getCustomNotificationSound();
  return () => soundListeners.delete(listener);
}

function openSoundDatabase() {
  return (soundDatabase ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(SOUND_DATABASE_NAME, 1);
    request.addEventListener("upgradeneeded", () => {
      request.result.createObjectStore(SOUND_STORE_NAME);
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  }));
}

async function withSoundStore<A>(
  mode: IDBTransactionMode,
  use: (store: IDBObjectStore) => IDBRequest<A>,
) {
  const transaction = (await openSoundDatabase()).transaction(SOUND_STORE_NAME, mode);
  const request = use(transaction.objectStore(SOUND_STORE_NAME));
  return new Promise<A>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(request.result));
    transaction.addEventListener("abort", () => reject(transaction.error));
    transaction.addEventListener("error", () => reject(transaction.error));
  });
}

export function getCustomNotificationSound() {
  return (customSound ??= withSoundStore<CustomNotificationSound | undefined>("readonly", (store) =>
    store.get(CUSTOM_SOUND_KEY),
  )
    .then((sound) => {
      publishCustomSound(sound);
      return sound;
    })
    .catch(() => {
      customSound = undefined;
      publishCustomSound(undefined);
      return undefined;
    }));
}

/** Validates that the browser can decode the file before replacing both notification sounds with it. */
export async function setCustomNotificationSound(file: File) {
  if (file.size > MAX_CUSTOM_NOTIFICATION_SOUND_BYTES) {
    throw new Error("Choose a sound file under 5 MB.");
  }
  try {
    await new OfflineAudioContext(1, 1, 44_100).decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error("This file isn't a sound RyCode can play. Try MP3, WAV, or OGG.");
  }
  const sound: CustomNotificationSound = {
    name: file.name,
    blob: new Blob([file], { type: file.type }),
  };
  await withSoundStore("readwrite", (store) => store.put(sound, CUSTOM_SOUND_KEY));
  customSound = Promise.resolve(sound);
  publishCustomSound(sound);
  buffers.delete(CUSTOM_SOUND_KEY);
  playingUntil.delete(CUSTOM_SOUND_KEY);
  return sound;
}

export async function clearCustomNotificationSound() {
  await withSoundStore("readwrite", (store) => store.delete(CUSTOM_SOUND_KEY));
  customSound = Promise.resolve(undefined);
  publishCustomSound(undefined);
  buffers.delete(CUSTOM_SOUND_KEY);
  playingUntil.delete(CUSTOM_SOUND_KEY);
}

/** Plays the current sound from a click, unlocking audio first. */
export async function previewNotificationSound() {
  audioContext ??= new AudioContext();
  await audioContext.resume().catch(() => undefined);
  await playNotificationSound("completion", () => true);
}

/** Keeps only the audible prefix so a long upload does not hold minutes of PCM in memory. */
function trimAudioBuffer(context: AudioContext, buffer: AudioBuffer) {
  const length = Math.min(
    buffer.length,
    Math.ceil(buffer.sampleRate * MAX_NOTIFICATION_SOUND_SECONDS),
  );
  if (length === buffer.length) return buffer;
  const trimmed = context.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    trimmed.copyToChannel(buffer.getChannelData(channel).subarray(0, length), channel);
  }
  return trimmed;
}

function loadNotificationBuffer(
  context: AudioContext,
  url: string,
  blob?: Blob,
): Promise<AudioBuffer> {
  let buffer = buffers.get(url);
  if (!buffer) {
    buffer = (blob ? blob.arrayBuffer() : fetch(url).then((response) => response.arrayBuffer()))
      .then((data) => context.decodeAudioData(data))
      .then((decoded) => (blob ? trimAudioBuffer(context, decoded) : decoded))
      .catch((error: unknown) => {
        buffers.delete(url);
        throw error;
      });
    buffers.set(url, buffer);
  }
  return buffer;
}

/** Called from a gesture so browsers allow later background playback. */
export function unlockNotificationAudio() {
  const firstUnlock = audioContext === undefined;
  audioContext ??= new AudioContext();
  void audioContext.resume().catch(() => undefined);
  if (!firstUnlock) return;
  // Fetch and decode during interaction so the first alert is ready when the thread finishes.
  for (const url of [completionUrl, inputUrl]) {
    void loadNotificationBuffer(audioContext, url).catch(() => undefined);
  }
}

export async function playNotificationSound(
  kind: "completion" | "input",
  shouldPlay: () => boolean,
) {
  if (!audioContext || audioContext.state !== "running") return;
  const context = audioContext;
  const custom = await getCustomNotificationSound();
  const url = custom ? CUSTOM_SOUND_KEY : kind === "completion" ? completionUrl : inputUrl;
  try {
    const decoded = await loadNotificationBuffer(context, url, custom?.blob);
    if (!shouldPlay() || context.state !== "running") return;
    // Coalesce same-sound bursts after decode to avoid clipping; input and completion alerts keep separate slots.
    if (context.currentTime < (playingUntil.get(url) ?? 0)) return;
    const source = context.createBufferSource();
    source.buffer = decoded;
    source.connect(context.destination);
    source.start();
    playingUntil.set(url, context.currentTime + decoded.duration);
  } catch {
    // A failed load is retried on the next alert.
  }
}
