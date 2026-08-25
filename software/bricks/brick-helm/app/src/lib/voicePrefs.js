const PLAYBACK_KEY = 'helm-voice-playback';
const KARAOKE_KEY = 'helm-voice-karaoke';

/** First visit / reload: priority to sessionStorage, fallback to localStorage. */
export function loadVoicePlaybackEnabled() {
  try {
    const sessionVal = sessionStorage.getItem(PLAYBACK_KEY);
    if (sessionVal !== null) return sessionVal === '1';
    const localVal = localStorage.getItem(PLAYBACK_KEY);
    if (localVal !== null) return localVal === '1';
    return true;
  } catch {
    return true;
  }
}

export function saveVoicePlaybackEnabled(enabled) {
  try {
    sessionStorage.setItem(PLAYBACK_KEY, enabled ? '1' : '0');
    localStorage.setItem(PLAYBACK_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function loadKaraokeEnabled() {
  try {
    const sessionVal = sessionStorage.getItem(KARAOKE_KEY);
    if (sessionVal !== null) return sessionVal === '1';
    const localVal = localStorage.getItem(KARAOKE_KEY);
    if (localVal !== null) return localVal === '1';
    return true;
  } catch {
    return true;
  }
}

export function saveKaraokeEnabled(enabled) {
  try {
    sessionStorage.setItem(KARAOKE_KEY, enabled ? '1' : '0');
    localStorage.setItem(KARAOKE_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

const MIC_KEY = 'helm-voice-mic';

/** Mic wanted for this tab — sessionStorage so F5 restores, a new tab stays off. */
export function loadMicWanted() {
  try {
    return sessionStorage.getItem(MIC_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveMicWanted(enabled) {
  try {
    sessionStorage.setItem(MIC_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}
