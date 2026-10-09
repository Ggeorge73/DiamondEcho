import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, SkipForward, Volume2, X } from 'lucide-react';
import { claimAudio, onAudioClaimed } from '../lib/audioFocus';
import './MarketBrief.css';

// The daily welcome, site tour and Georgia market brief, read aloud.
//
// Browsers do not let a page play sound before the visitor has interacted
// with it. The player tries to start at once; where the browser refuses, it
// starts on the visitor's first click, tap or key press anywhere on the
// page. Pause is always on screen (WCAG 2.2.2 / 1.4.2). A visitor who pauses,
// closes or finishes the brief is not played it again in the same visit.
//
// Every figure comes from the DiamondEcho service with its publisher, period
// and link (backend/market_brief). Without a service address the player is
// not shown at all.

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
const dayLabel = (iso) => {
  const day = new Date(`${iso}T12:00:00`);
  return Number.isNaN(day.getTime()) ? 'Today'
    : day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};
const CHAPTER_NAMES = { chime: 'Welcome and site tour', tour: 'Welcome and site tour', market: "Today's Georgia market" };

const MarketBrief = () => {
  const [brief, setBrief] = useState(null);
  // waiting | playing | paused | ended | closed. Already heard this visit: start closed.
  const [status, setStatus] = useState(() => (remembered() ? 'closed' : 'waiting'));
  const [chapter, setChapter] = useState('tour');
  const [showTranscript, setShowTranscript] = useState(false);
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

  // Stop the sound when the visitor leaves the page.
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const onEnded = () => {
    const after = ORDER[ORDER.indexOf(chapterRef.current) + 1];
    if (after) playChapter(after).catch(() => setStatus('paused'));
    else {
      setStatus('ended');
      remember();
    }
  };

  const togglePlay = () => {
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
      Promise.resolve(audio.play()).catch(() => setStatus('paused'));
    }
  };

  const skipToMarket = () => {
    startedRef.current = true;
    if (audioRef.current) audioRef.current.currentTime = 0;
    playChapter('market').catch(() => setStatus('paused'));
  };

  const close = () => {
    audioRef.current?.pause();
    setStatus('closed');
    remember();
  };

  if (!base || !brief) return null;

  const { market } = brief;
  const playing = status === 'playing';
  const statusText = {
    waiting: 'Tap anywhere on the page to hear your welcome tour and today’s Georgia market brief.',
    playing: `Playing: ${CHAPTER_NAMES[chapter]}`,
    paused: `Paused: ${CHAPTER_NAMES[chapter]}`,
    ended: 'Finished. Press play to hear it again.',
    closed: '',
  }[status];

  const controls = hasAudio && (
    <div className="mf-brief__controls">
      <button type="button" className="mf-brief__play" onClick={togglePlay}
        aria-label={playing ? 'Pause the audio' : 'Play the welcome tour and market brief'}>
        {playing ? <Pause /> : <Play />}
      </button>
      {brief?.market?.audio_url && chapter !== 'market' && (
        <button type="button" className="mf-brief__skip" onClick={skipToMarket}>
          <SkipForward /> Today’s market
        </button>
      )}
    </div>
  );

  return (
    <>
      <audio ref={audioRef} preload="none" onEnded={onEnded} hidden />

      <section className="mf-brief" id="market-brief" aria-labelledby="market-brief-heading" data-market-brief>
        <div className="mf-brief__inner">
          <div className="mf-brief__head">
            <p className="eyebrow">DiamondEcho daily brief · {dayLabel(brief.date)}</p>
            <h2 id="market-brief-heading">Today’s Georgia market.<br /><em>Read aloud.</em></h2>
            <p>
              A short welcome and guide to this site, followed by the latest Georgia housing and
              mortgage figures from public sources. Each figure shows who published it and the period it covers.
            </p>
            {controls}
            <p className="mf-brief__status" aria-live="polite">{status !== 'closed' && statusText}</p>
          </div>

          {market.items.length > 0 ? (
            <ul className="mf-brief__figures">
              {market.items.map((item) => (
                <li key={item.id}>
                  <small>{item.label} · {item.region}</small>
                  {item.value && <strong>{item.value}</strong>}
                  {item.change && <span className="mf-brief__change">{item.change}</span>}
                  <span className="mf-brief__period">{item.period}</span>
                  <a href={item.source_url} target="_blank" rel="noopener noreferrer">{item.source}</a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mf-brief__empty">Today’s market figures aren’t available right now. Please check back later.</p>
          )}

          <div className="mf-brief__foot">
            <button type="button" className="text-link" onClick={() => setShowTranscript((open) => !open)}
              aria-expanded={showTranscript} aria-controls="market-brief-transcript">
              {showTranscript ? 'Hide transcript' : 'Read the transcript'}
            </button>
            <p>General market information from the sources named, not advice about any property or loan.</p>
          </div>
          {showTranscript && (
            <div className="mf-brief__transcript" id="market-brief-transcript">
              <p>{brief.tour.script}</p>
              <p>{market.script}</p>
            </div>
          )}
        </div>
      </section>

      {hasAudio && status !== 'closed' && status !== 'ended' && (
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
    </>
  );
};

export default MarketBrief;
