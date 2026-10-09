import React, { useEffect, useRef } from 'react';
import { claimAudio, onAudioClaimed } from '../lib/audioFocus';
import { episodeDate } from '../lib/podcast';

// One podcast episode: title, date, description and the browser's own audio
// controls, which work with a keyboard, a screen reader and on phones.
const EpisodePlayer = ({ episode, headingLevel = 3 }) => {
  const audioRef = useRef(null);
  const owner = `episode-${episode.id}`;
  useEffect(() => onAudioClaimed(owner, () => audioRef.current?.pause()), [owner]);
  const Heading = `h${headingLevel}`;
  const date = episodeDate(episode.published_at);
  return (
    <article className="mf-episode" aria-labelledby={`${owner}-title`}>
      {date && <small>{date}</small>}
      <Heading id={`${owner}-title`}>{episode.title}</Heading>
      {episode.description && <p>{episode.description}</p>}
      <audio
        ref={audioRef}
        controls
        preload="none"
        src={episode.audio_url}
        onPlay={() => claimAudio(owner)}
        aria-label={`Play episode: ${episode.title}`}
      >
        <a href={episode.audio_url}>Download the episode</a>
      </audio>
    </article>
  );
};

export default EpisodePlayer;
