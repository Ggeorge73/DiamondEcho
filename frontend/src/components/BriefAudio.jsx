import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Volume2, X } from 'lucide-react';
import { claimAudio, onAudioClaimed } from '../lib/audioFocus';
import './MarketBrief.css';

// The daily welcome, site tour and Georgia market brief, read aloud.
//
// The player lives above the pages (App.js), so the sound carries on while the
// visitor moves around the site; only pause or close stops it. The home page
// section (MarketBrief.jsx) shows the figures and the same controls.
//
// Browsers do not let a page play sound before the visitor has interacted
// with it. The player tries to start at once; where the browser refuses, it
// starts on the visitor's first click, tap or key press anywhere on the site.
// Pause is always on screen (WCAG 2.2.2 / 1.4.2). A visitor who pauses, closes
// or finishes the brief is not played it again in the same visit.
//
// Every figure comes from the DiamondEcho service with its publisher, period
// and link (backend/market_brief). Without a service address nothing is shown.

export const HEARD_KEY = 'de-market-brief-heard';
const backendUrl = () => (process.env.REACT_APP_BACKEND_URL || '').trim().replace(/\/$/, '');

const remembered = () => {
  try { return window.sessionStorage.getItem(HEARD_KEY) === '1'; } catch { return false; }
};
const remember = () => {
  try { window.sessionStorage.setItem(HEARD_KEY, '1'); } catch { /* private mode: nothing to keep */ }
};

// A soft two-note bell before the voice, built here as a short WAV clip and
// played through the same audio element as the voice. (A Web Audio chime was
// skipped when the browser allowed autoplay, and an iPhone's silent switch
// mutes Web Audio but not media playback.)
const SAMPLE_RATE = 16000;
let chimeSource = null;
export const chimeUri = () => {
  if (chimeSource) return chimeSource;
  const seconds = 1.6;
  const count = Math.round(SAMPLE_RATE * seconds);
  const view = new DataView(new ArrayBuffer(44 + count * 2));
  const text = (offset, value) => [...value].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, count * 2, true);
  const notes = [[659.25, 0], [880, 0.28]]; // E5 then A5
  for (let i = 0; i < count; i += 1) {
    const t = i / SAMPLE_RATE;
    let sample = 0;
    notes.forEach(([frequency, delay]) => {
      const local = t - delay;
      if (local < 0) return;
      const envelope = Math.min(1, local / 0.012) * Math.exp(-local * 3.2);
      // A little of the octave above makes it ring like a bell, not a beep.
      sample += envelope * (Math.sin(2 * Math.PI * frequency * local)
        + 0.25 * Math.sin(4 * Math.PI * frequency * local));
    });
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample * 0.32)) * 0x7fff, true);
  }
  let binary = '';
  const bytes = new Uint8Array(view.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  chimeSource = `data:audio/wav;base64,${window.btoa(binary)}`;
  return chimeSource;
};

const ORDER = ['chime', 'tour', 'market'];
export const CHAPTER_NAMES = { chime: 'Welcome and site tour', tour: 'Welcome and site tour', market: "Today's Georgia market" };

const BriefAudioContext = createContext(null);
// Null outside the provider, or before the brief has loaded.
export const useBriefAudio = () => useContext(BriefAudioContext);

export const BriefAudioProvider = ({ children }) => {
  const [brief, setBrief] = useState(null);
  // waiting | playing | paused | ended | closed. Already heard this visit: start closed.
  const [status, setStatus] = useState(() => (remembered() ? 'closed' : 'waiting'));
  const [chapter, setChapter] = useState('tour');
  const audioRef = useRef(null);
  const chapterRef = useRef('tour');
  const startedRef = useRef(false);

  const base = backendUrl();

  useEffect(() => {
    if (!base) return undefined;
    let cancelled = false;
    fetch(`${base}/api/v1/market-brief`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => { if (!cancelled && body) setBrief(body); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [base]);

  const urlFor = useCallback((name) => {
    if (name === 'chime') return chimeUri();
    const path = brief?.[name]?.audio_url;
    return path ? `${base}${path}` : null;
  }, [brief, base]);

  const hasAudio = Boolean(brief?.tour?.audio_url || brief?.market?.audio_url);

  // Plays `name`, or the next part after it that has audio.
  const playChapter = useCallback((name) => {
    const audio = audioRef.current;
    const next = ORDER.slice(ORDER.indexOf(name)).find((part) => urlFor(part));
    if (!audio || !next || !hasAudio) {
      setStatus('ended');
      remember();
      return Promise.resolve();
    }
    chapterRef.current = next;
    setChapter(next);
    audio.setAttribute('src', urlFor(next));
    setStatus('playing');
    claimAudio('brief');
    return Promise.resolve(audio.play());
  }, [urlFor, hasAudio]);

  // From a click, tap or key press. play() is called inside the gesture, which
  // is what iPhone Safari needs to allow sound.
  const startFromGesture = useCallback(() => {
    startedRef.current = true;
    playChapter('chime').catch(() => setStatus('paused'));
  }, [playChapter]);

  // Start on load if the browser allows it, otherwise on the first interaction.
  useEffect(() => {
    if (!brief || !hasAudio || remembered()) return undefined;
    let waiting = true;
    const onGesture = (event) => {
      if (!waiting || event.target?.closest?.('[data-market-brief]')) return;
      waiting = false;
      startFromGesture();
    };
    playChapter('chime')
      .then(() => { waiting = false; startedRef.current = true; })
      .catch(() => { setStatus('waiting'); });
    document.addEventListener('click', onGesture, true);
    document.addEventListener('keydown', onGesture, true);
    return () => {
      waiting = false;
      document.removeEventListener('click', onGesture, true);
      document.removeEventListener('keydown', onGesture, true);
    };
  }, [brief, hasAudio, playChapter, startFromGesture]);

  // A podcast episode that starts playing pauses the brief.
  useEffect(() => onAudioClaimed('brief', () => {
    audioRef.current?.pause();
    setStatus((current) => (current === 'playing' ? 'paused' : current));
  }), []);

  const onEnded = () => {
    const after = ORDER[ORDER.indexOf(chapterRef.current) + 1];
    if (after) playChapter(after).catch(() => setStatus('paused'));
    else {
      setStatus('ended');
      remember();
    }
  };

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (status === 'playing') {
      audio.pause();
      setStatus('paused');
      remember();
    } else if (!startedRef.current || status === 'ended') {
      startFromGesture();
    } else {
      setStatus('playing');
      claimAudio('brief');
      Promise.resolve(audio.play()).catch(() => setStatus('paused'));
    }
  }, [status, startFromGesture]);

  const skipToMarket = useCallback(() => {
    startedRef.current = true;
    if (audioRef.current) audioRef.current.currentTime = 0;
    playChapter('market').catch(() => setStatus('paused'));
  }, [playChapter]);

  const close = useCallback(() => {
    audioRef.current?.pause();
    setStatus('closed');
    remember();
  }, []);

  const value = useMemo(() => (base && brief ? {
    brief, status, chapter, hasAudio, playing: status === 'playing', togglePlay, skipToMarket,
  } : null), [base, brief, status, chapter, hasAudio, togglePlay, skipToMarket]);

  const playing = status === 'playing';

  return (
    <BriefAudioContext.Provider value={value}>
      {children}
      {value && <audio ref={audioRef} preload="none" onEnded={onEnded} hidden />}
      {value && hasAudio && status !== 'closed' && status !== 'ended' && (
        <div className="mf-brief-bar" role="region" aria-label="Audio guide" data-market-brief>
          <Volume2 className="mf-brief-bar__icon" aria-hidden="true" />
          <span className="mf-brief-bar__text">
            {status === 'waiting' ? 'Tap anywhere to hear your welcome to DiamondEcho' : CHAPTER_NAMES[chapter]}
          </span>
          <button type="button" className="mf-brief__play" onClick={togglePlay}
            aria-label={playing ? 'Pause the audio' : 'Play the welcome tour and market brief'}>
            {playing ? <Pause /> : <Play />}
          </button>
          <button type="button" className="mf-brief-bar__close" onClick={close} aria-label="Stop and close the audio guide">
            <X />
          </button>
        </div>
      )}
    </BriefAudioContext.Provider>
  );
};
