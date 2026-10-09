import React, { useEffect, useState } from 'react';
import EpisodePlayer from '../components/EpisodePlayer';
import { fetchEpisodes, podcastAvailable } from '../lib/podcast';
import '../components/Podcast.css';

// Every published episode, newest first.
const Podcast = () => {
  const [state, setState] = useState({ loading: podcastAvailable(), items: [] });
  useEffect(() => {
    if (!podcastAvailable()) return undefined;
    let cancelled = false;
    fetchEpisodes()
      .then((items) => { if (!cancelled) setState({ loading: false, items }); })
      .catch(() => { if (!cancelled) setState({ loading: false, items: [] }); });
    return () => { cancelled = true; };
  }, []);
  return (
    <main className="mf-podcast-page">
      <div className="mf-podcast-page__inner">
        <p className="eyebrow">The DiamondEcho podcast</p>
        <h1>Conversations on Georgia real estate.</h1>
        <p className="mf-podcast-page__lede">
          Episodes recorded by DiamondEcho on buying, selling and investing in Georgia. General
          information, not advice about any property or loan.
        </p>
        {state.loading && <p role="status">Loading episodes…</p>}
        {!state.loading && state.items.length === 0 && (
          <p className="mf-podcast-page__empty">The first episode is on its way. Please check back soon.</p>
        )}
        {state.items.length > 0 && (
          <ol className="mf-podcast-page__list" aria-label="Episodes, newest first">
            {state.items.map((episode) => (
              <li key={episode.id}><EpisodePlayer episode={episode} headingLevel={2} /></li>
            ))}
          </ol>
        )}
      </div>
    </main>
  );
};

export default Podcast;
