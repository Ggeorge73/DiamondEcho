// Only one sound plays at a time. A player that starts tells the others, and
// each other player pauses itself (the daily brief and podcast episodes).
const EVENT = 'de-audio-focus';

export const claimAudio = (owner) => window.dispatchEvent(new CustomEvent(EVENT, { detail: owner }));

export const onAudioClaimed = (owner, pause) => {
  const handler = (event) => { if (event.detail !== owner) pause(); };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
};
