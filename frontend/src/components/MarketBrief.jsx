import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, SkipForward, Volume2, X } from 'lucide-react';
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

// A soft two-note chime before the voice, made in the browser: no file to load.
const chime = () => {
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    const context = new Context();
    [[659.25, 0], [880, 0.22]].forEach(([frequency, delay]) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + delay;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 1);
    });
    window.setTimeout(() => context.close().catch(() => {}), 1600);
  } catch { /* no chime is fine */ }
};

const CHIME_MS = 900;

const dayLabel = (iso) => {
  const day = new Date(`${iso}T12:00:00`);
  return Number.isNaN(day.getTime()) ? 'Today'
    : day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};
const CHAPTER_NAMES = { tour: 'Welcome and site tour', market: "Today's Georgia market" };

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
    const path = brief?.[name]?.audio_url;
    return path ? `${base}${path}` : null;
  }, [brief, base]);

  const hasAudio = Boolean(urlFor('tour') || urlFor('market'));

  const playChapter = useCallback((name) => {
    const audio = audioRef.current;
    const next = name === 'tour' && !urlFor('tour') ? 'market' : name;
    const source = urlFor(next);
    if (!audio || !source) {
      setStatus('ended');
      remember();
      return Promise.resolve();
    }
    chapterRef.current = next;
    setChapter(next);
    if (audio.getAttribute('src') !== source) audio.setAttribute('src', source);
    setStatus('playing');
    return Promise.resolve(audio.play());
  }, [urlFor]);

  // From a click or key press: unlock the audio element inside the gesture
  // (iPhone Safari needs that), sound the chime, then start the voice.
  const startFromGesture = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const audio = audioRef.current;
    const first = urlFor('tour') || urlFor('market');
    if (!audio || !first) return;
    audio.setAttribute('src', first);
    Promise.resolve(audio.play()).then(() => audio.pause()).catch(() => {});
    chime();
    setStatus('playing');
    window.setTimeout(() => {
      if (chapterRef.current === 'tour' && audioRef.current) {
        audioRef.current.currentTime = 0;
        playChapter('tour').catch(() => setStatus('paused'));
      }
    }, CHIME_MS);
  }, [playChapter, urlFor]);

  // Start on load if the browser allows it, otherwise on the first interaction.
  useEffect(() => {
    if (!brief || !hasAudio || remembered()) return undefined;
    let waiting = true;
    const onGesture = (event) => {
      if (!waiting || event.target?.closest?.('[data-market-brief]')) return;
      waiting = false;
      startFromGesture();
    };
    playChapter('tour')
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

  // Stop the sound when the visitor leaves the page.
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const onEnded = () => {
    if (chapterRef.current === 'tour' && urlFor('market')) {
      playChapter('market').catch(() => setStatus('paused'));
    } else {
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
      startedRef.current = false;
      chapterRef.current = 'tour';
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
      {urlFor('market') && chapter === 'tour' && (
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
