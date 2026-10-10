// Podcast episodes uploaded by DiamondEcho staff (backend/podcast). Only
// published episodes are listed. Without a service address there is no list.
const backendUrl = () => (process.env.REACT_APP_BACKEND_URL || '').trim().replace(/\/$/, '');

export const podcastAvailable = () => Boolean(backendUrl());

export const fetchEpisodes = async () => {
  const base = backendUrl();
  if (!base) return [];
  const response = await fetch(`${base}/api/v1/podcast/episodes`);
  if (!response.ok) return [];
  const body = await response.json();
  return Array.isArray(body?.items) ? body.items : [];
};

const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' });

export const episodeDate = (iso) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : day.format(date);
};
