// The game plays every "music/*" clip with DOM audio, but Cocos loads each clip with its baked
// WEB_AUDIO mode first, so ~400 MB of decoded PCM sits unused once a level loads. iPad Safari kills
// the page past its per-tab memory limit and reloads it, sending the child back to the main menu.
// Loading music clips as DOM audio from the start skips that decode; short sound effects stay on
// Web Audio so their playback latency is unchanged.

export function isAppleMobile(nav = globalThis.navigator) {
  if (!nav) return false;
  if (/iPad|iPhone|iPod/.test(nav.userAgent ?? "")) return true;
  // iPadOS 13+ Safari reports a Mac user agent; touch support tells it apart from a real Mac.
  return nav.platform === "MacIntel" && nav.maxTouchPoints > 1;
}

export function installMusicStreaming({ AudioClip, bundle, musicPrefix = "music/" }) {
  const proto = AudioClip?.prototype;
  const original = proto && Object.getOwnPropertyDescriptor(proto, "_nativeDep");
  if (typeof original?.get !== "function") throw new TypeError("AudioClip._nativeDep getter must be available");
  const domAudio = AudioClip.AudioType?.DOM_AUDIO;
  if (!Number.isInteger(domAudio)) throw new TypeError("AudioClip.AudioType.DOM_AUDIO must be available");

  const isMusic = (uuid) => {
    const path = typeof uuid === "string" ? bundle.getAssetInfo(uuid)?.path : undefined;
    return typeof path === "string" && path.startsWith(musicPrefix);
  };

  Object.defineProperty(proto, "_nativeDep", {
    configurable: true,
    enumerable: original.enumerable,
    get() {
      const dep = original.get.call(this);
      if (dep && isMusic(this._uuid)) dep.audioLoadMode = domAudio;
      return dep;
    },
  });

  return { restore() { Object.defineProperty(proto, "_nativeDep", original); } };
}
