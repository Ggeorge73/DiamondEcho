// The Ask DiamondEcho assistant answers from the DiamondEcho service. A build
// with no service address has nothing to ask, so it must not offer the
// assistant: the launcher and every "Ask the concierge" entry point read this
// (DE-20). It is the same test the inquiry forms use.
export const assistantAvailable = () => Boolean((process.env.REACT_APP_BACKEND_URL || '').trim());

export const openAssistant = () => window.dispatchEvent(new CustomEvent('open-diamond-assistant'));
