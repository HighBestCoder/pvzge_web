import { describe, expect, test } from "bun:test";

import { installMusicStreaming, isAppleMobile } from "../docs/learning/music-streaming.js";

const WEB_AUDIO = 1;
const DOM_AUDIO = 0;

function fakeAudioClip() {
  class AudioClip {
    constructor(uuid) { this._uuid = uuid; this._loadMode = WEB_AUDIO; }
    get _nativeDep() { return { uuid: this._uuid, audioLoadMode: this._loadMode, ext: ".mp3", __isNative__: true }; }
  }
  AudioClip.AudioType = { DOM_AUDIO, WEB_AUDIO };
  return AudioClip;
}

const bundle = {
  getAssetInfo(uuid) {
    return { "music-uuid": { path: "music/inGame/pirate/P4_LP_Pirate" }, "sfx-uuid": { path: "sounds/plant" } }[uuid];
  },
};

describe("music clips load as DOM audio", () => {
  test("only clips under music/ switch to DOM audio", () => {
    const AudioClip = fakeAudioClip();
    installMusicStreaming({ AudioClip, bundle });

    expect(new AudioClip("music-uuid")._nativeDep.audioLoadMode).toBe(DOM_AUDIO);
    expect(new AudioClip("sfx-uuid")._nativeDep.audioLoadMode).toBe(WEB_AUDIO);
    expect(new AudioClip("scene-only-uuid")._nativeDep.audioLoadMode).toBe(WEB_AUDIO);
    expect(new AudioClip("music-uuid")._nativeDep.uuid).toBe("music-uuid");
  });

  test("restore puts the engine getter back", () => {
    const AudioClip = fakeAudioClip();
    const streaming = installMusicStreaming({ AudioClip, bundle });

    streaming.restore();

    expect(new AudioClip("music-uuid")._nativeDep.audioLoadMode).toBe(WEB_AUDIO);
  });

  test("fails loudly when the engine seam changes", () => {
    class AudioClip {}
    AudioClip.AudioType = { DOM_AUDIO };

    expect(() => installMusicStreaming({ AudioClip, bundle })).toThrow(TypeError);
  });
});

describe("Apple mobile detection", () => {
  test("recognises iPhone, iPad, and iPadOS desktop-mode Safari", () => {
    expect(isAppleMobile({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" })).toBe(true);
    expect(isAppleMobile({ userAgent: "Mozilla/5.0 (iPad; CPU OS 16_7 like Mac OS X)" })).toBe(true);
    expect(isAppleMobile({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
  });

  test("leaves a real Mac and other desktops alone", () => {
    expect(isAppleMobile({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
    expect(isAppleMobile({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", platform: "Win32",
      maxTouchPoints: 0 })).toBe(false);
    expect(isAppleMobile(null)).toBe(false);
  });
});
