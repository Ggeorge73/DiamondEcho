import React, { useState } from 'react';
import { Pause, Play, SkipForward } from 'lucide-react';
import { CHAPTER_NAMES, useBriefAudio } from './BriefAudio';
import './MarketBrief.css';

// The home page section of the daily brief: the day's figures, each with its
// publisher, period and link, the transcript, and the same controls as the
// audio bar. The sound itself is played by BriefAudioProvider (App.js), so it
// carries on when the visitor leaves this page.

const dayLabel = (iso) => {
  const day = new Date(`${iso}T12:00:00`);
  return Number.isNaN(day.getTime()) ? 'Today'
    : day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};

const MarketBrief = () => {
  const audio = useBriefAudio();
  const [showTranscript, setShowTranscript] = useState(false);
  if (!audio) return null;

  const { brief, status, chapter, hasAudio, playing, togglePlay, skipToMarket } = audio;
  const { market } = brief;
  const statusText = {
    waiting: 'Tap anywhere on the page to hear your welcome tour and today’s Georgia market brief.',
    playing: `Playing: ${CHAPTER_NAMES[chapter]}`,
    paused: `Paused: ${CHAPTER_NAMES[chapter]}`,
    ended: 'Finished. Press play to hear it again.',
    closed: '',
  }[status];

  return (
    <section className="mf-brief" id="market-brief" aria-labelledby="market-brief-heading" data-market-brief>
      <div className="mf-brief__inner">
        <div className="mf-brief__head">
          <p className="eyebrow">DiamondEcho daily brief</p>
          <p className="mf-brief__date">{dayLabel(brief.date)}</p>
          <h2 id="market-brief-heading">Today’s Georgia market. <em>Read aloud.</em></h2>
          <p className="mf-brief__lede">
            A short welcome and guide to this site, followed by the latest Georgia housing and
            mortgage figures from public sources. Each figure shows who published it and the period it covers.
          </p>
          {hasAudio && (
            <div className="mf-brief__controls">
              <button type="button" className="mf-brief__play" onClick={togglePlay}
                aria-label={playing ? 'Pause the audio' : 'Play the welcome tour and market brief'}>
                {playing ? <Pause /> : <Play />}
              </button>
              {market.audio_url && chapter !== 'market' && (
                <button type="button" className="mf-brief__skip" onClick={skipToMarket}>
                  <SkipForward /> Today’s market
                </button>
              )}
            </div>
          )}
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
  );
};

export default MarketBrief;
