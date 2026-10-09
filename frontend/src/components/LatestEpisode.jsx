import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import EpisodePlayer from './EpisodePlayer';
import { fetchEpisodes, podcastAvailable } from '../lib/podcast';
import './Podcast.css';

// The newest podcast episode, directly below the daily brief on the home page.
// Nothing is shown until an episode has been published.
const LatestEpisode = () => {
  const [latest, setLatest] = useState(null);
  useEffect(() => {
    if (!podcastAvailable()) return undefined;
    let cancelled = false;
    fetchEpisodes().then((items) => { if (!cancelled && items.length) setLatest(items[0]); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  if (!latest) return null;
  return (
    <section className="mf-latest-episode" aria-labelledby="latest-episode-heading">
      <div className="mf-latest-episode__inner">
        <div>
          <p className="eyebrow">The DiamondEcho podcast</p>
          <h2 id="latest-episode-heading">Latest episode</h2>
          <Link className="text-link" to="/podcast">All episodes <ArrowUpRight /></Link>
        </div>
        <EpisodePlayer episode={latest} />
      </div>
    </section>
  );
};

export default LatestEpisode;
