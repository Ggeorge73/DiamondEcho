import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, Bot, ExternalLink, Loader2, MessageCircle, RotateCcw, Send, ShieldCheck, X } from "lucide-react";
import { assistantAvailable } from "../../lib/assistant";

const QUICK_PROMPTS = [
  "Help me plan a home purchase",
  "Analyze a rental property",
  "What should I compare in a mortgage?",
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// A source's own review date ("2026-07-09"), written out. It is read as a
// calendar date, not a moment, so no time zone can move it by a day.
export const formatReviewed = (value) => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!parts) return "";
  const month = MONTHS[Number(parts[2]) - 1];
  return month ? `${month} ${Number(parts[3])}, ${parts[1]}` : "";
};

// Links in an answer may only open pages of this site.
export const isSitePath = (path) => typeof path === "string" && /^\/(?!\/)[A-Za-z0-9\-/?=&]*$/.test(path);

const HANDOFF_KINDS = ["buyer", "seller", "tour"];
const HANDOFF_LABEL = "Send a request to a DiamondEcho agent";

// Where "talk to a person" leads: the request form, which is the one way a
// visitor's details reach staff. Nothing from the chat goes with it.
export const handoffFor = (item) => {
  if (item.handoff && HANDOFF_KINDS.includes(item.handoff.kind)) {
    const topic = item.handoff.topic === "pre-approval" ? "&topic=pre-approval" : "";
    return { path: `/inquire?type=${item.handoff.kind}${topic}`, label: item.handoff.label || HANDOFF_LABEL };
  }
  if (item.handoff_recommended || item.failed) return { path: "/inquire?type=buyer", label: HANDOFF_LABEL };
  return null;
};

const ACTION_CLASS = "inline-flex items-center gap-1.5 rounded-lg border border-[#5e9cd0]/50 px-3 py-2 text-xs font-semibold text-[#dce8f2] transition hover:border-[#7fb3de] hover:bg-[#5e9cd0]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7fb3de]";

// Resting box of the launcher: bottom-5 and right-5 on the wrapper, h-14 on the button.
const LAUNCHER_OFFSET = 20;
const LAUNCHER_HEIGHT = 56;
const LAUNCHER_FULL_WIDTH = 188;

// True when the labelled launcher would sit on top of the Georgia MLS frame.
export const launcherOverlapsFrame = (frameRect, viewport, launcherWidth = LAUNCHER_FULL_WIDTH) => {
  const bottom = viewport.height - LAUNCHER_OFFSET;
  const top = bottom - LAUNCHER_HEIGHT;
  const right = viewport.width - LAUNCHER_OFFSET;
  const left = right - launcherWidth;
  return frameRect.top < bottom && frameRect.bottom > top
    && frameRect.left < right && frameRect.right > left;
};

const AssistantPanel = () => {
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);
  const [overSearchFrame, setOverSearchFrame] = useState(false);
  const [message, setMessage] = useState("");
  const [state, setState] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([]);
  const promptRef = useRef(null);
  const triggerRef = useRef(null);
  const backendUrl = useMemo(() => (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, ""), []);

  useEffect(() => {
    const openAssistant = () => setOpen(true);
    window.addEventListener("open-diamond-assistant", openAssistant);
    return () => window.removeEventListener("open-diamond-assistant", openAssistant);
  }, []);
  useEffect(() => { if (open) promptRef.current?.focus(); }, [open]);
  // The provider frame is cross-origin, so nothing inside it can be moved out of
  // the way. While the launcher would cover it, the launcher shrinks to its icon.
  useEffect(() => {
    const request = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 16));
    const cancel = window.cancelAnimationFrame || window.clearTimeout;
    let pending = 0;
    const measure = () => {
      pending = 0;
      // More than one search frame can be in the page (for-sale and rentals each
      // keep one, and the search page stays loaded while hidden). A frame that
      // is not shown measures as empty and so never counts as covered.
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      setOverSearchFrame([...document.querySelectorAll(".de-idx__frame")]
        .some((frame) => launcherOverlapsFrame(frame.getBoundingClientRect(), viewport)));
    };
    const schedule = () => { if (!pending) pending = request(measure); };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (pending) cancel(pending);
    };
  }, [pathname, search]);
  const compact = overSearchFrame && !open;
  const closeAssistant = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  // `retry` asks the question that just failed again: the visitor's message is
  // already on screen, so only the failure notice is replaced.
  const sendMessage = async (text = message, { retry = false } = {}) => {
    const clean = text.trim();
    if (!clean || loading) return;
    const kept = messages.filter((item) => !item.failed);
    const history = retry ? kept : [...kept, { role: "user", content: clean }];
    setMessages(history);
    if (!retry) setMessage("");
    setLoading(true);
    try {
      const { data } = await axios.post(`${backendUrl}/api/assistant/chat`, {
        message: clean,
        jurisdiction: { country: "US", state: state.trim() || null },
        history: history.slice(-8).map(({ role, content }) => ({ role, content })),
      });
      if (typeof data?.answer !== "string" || !data.answer.trim()) throw new Error("No answer");
      // A state the visitor named in the chat is kept for the next question.
      if (!state.trim() && typeof data.jurisdiction?.state === "string") setState(data.jurisdiction.state);
      setMessages((current) => [...current, { ...data, role: "assistant", content: data.answer }]);
    } catch {
      setMessages((current) => [...current, {
        role: "assistant",
        failed: true,
        question: clean,
        content: "I couldn’t get an answer just now. Your question was not lost: try again, or send a request and a DiamondEcho agent will follow up.",
        citations: [],
        disclaimers: [],
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-[70] font-sans">
      {/* Height leaves room for the launcher below and the site header above, so the
          panel's own title and Close button are never under the header on a phone. */}
      {open && (
        <section
          aria-label="DiamondEcho real estate assistant"
          className="mb-4 flex h-[min(720px,calc(100vh-11rem))] w-[min(430px,calc(100vw-2rem))] flex-col overflow-hidden border border-[#2d628c]/35 bg-[#0f1c2a] shadow-2xl"
        >
          <header className="flex items-center justify-between bg-[#0c1826] px-5 py-4 text-white">
            <div className="flex items-center gap-3">
              <span className="rounded-full border border-[#5e9cd0]/60 bg-[#5e9cd0]/10 p-2"><Bot className="h-5 w-5 text-[#a9c7e0]" /></span>
              <div>
                <h2 className="font-serif text-lg tracking-wide">Property Intelligence</h2>
                <p className="text-xs text-white/65">Grounded guidance · cited sources</p>
              </div>
            </div>
            <button onClick={closeAssistant} aria-label="Close assistant" className="rounded-full p-2 hover:bg-white/10"><X className="h-5 w-5" /></button>
          </header>

          <div className="border-b border-[#dce8f2]/10 bg-[#0f1c2a]/70 px-4 py-3">
            <label htmlFor="assistant-state" className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-[#dce8f2]/60">Property state (for local context)</label>
            <input id="assistant-state" value={state} onChange={(event) => setState(event.target.value)} placeholder="e.g. NY" maxLength={30} className="w-full rounded-lg border border-[#dce8f2]/15 bg-[#142434] px-3 py-2 text-sm outline-none focus:border-[#5e9cd0]" />
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.length === 0 && (
              <div className="space-y-4">
                <div className="rounded-xl border border-[#5e9cd0]/20 bg-[#142434] p-4 text-sm leading-6 text-[#dce8f2]">
                  Ask about buying, selling, renting, financing, taxes, or deal analysis. I’ll show assumptions and source regulated topics.
                </div>
                <div className="grid gap-2">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button key={prompt} onClick={() => sendMessage(prompt)} className="rounded-xl border border-[#dce8f2]/10 bg-[#142434] px-4 py-3 text-left text-sm text-[#dce8f2] transition hover:border-[#5e9cd0] hover:bg-[#5e9cd0]/5">{prompt}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((item, index) => {
              const assistant = item.role === "assistant";
              const handoff = assistant ? handoffFor(item) : null;
              const links = assistant ? (item.links || []).filter((link) => isSitePath(link?.path) && link.label) : [];
              const questions = assistant ? (item.follow_up_questions || []).filter(Boolean) : [];
              const last = index === messages.length - 1;
              return (
                <article key={`${item.role}-${index}`} data-failed={item.failed ? "true" : undefined} className={item.role === "user" ? "ml-10 rounded-2xl rounded-br-sm bg-[#2d628c] px-4 py-3 text-sm leading-6 text-white" : "mr-5 rounded-2xl rounded-bl-sm border border-[#dce8f2]/10 bg-[#142434] px-4 py-3 text-sm leading-6 text-[#dce8f2]"}>
                  <p className="whitespace-pre-wrap">{item.content}</p>
                  {questions.length > 0 && (
                    <div className="mt-3 rounded-lg border border-[#5e9cd0]/25 bg-[#0f1c2a] px-3 py-2">
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[#dce8f2]/60">To go further, tell me</p>
                      <ul className="list-disc space-y-1 pl-4 text-xs leading-5">
                        {questions.map((question) => <li key={question}>{question}</li>)}
                      </ul>
                    </div>
                  )}
                  {(links.length > 0 || handoff || (item.failed && last)) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.failed && last && (
                        <button type="button" disabled={loading} onClick={() => sendMessage(item.question, { retry: true })} className={`${ACTION_CLASS} disabled:cursor-not-allowed disabled:opacity-40`}>
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Try again
                        </button>
                      )}
                      {links.map((link) => (
                        <Link key={link.path} to={link.path} onClick={() => setOpen(false)} className={ACTION_CLASS}>
                          {link.label}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      ))}
                      {handoff && (
                        <Link to={handoff.path} onClick={() => setOpen(false)} data-handoff="true" className={`${ACTION_CLASS} border-[#d9c28f]/60 text-[#f1e3bf] hover:border-[#d9c28f] hover:bg-[#d9c28f]/10`}>
                          {handoff.label}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      )}
                    </div>
                  )}
                  {handoff && <p className="mt-2 text-[11px] leading-4 text-[#dce8f2]/65">Your chat is not sent with the request. The form asks for what an agent needs.</p>}
                  {item.citations?.length > 0 && (
                    <div className="mt-3 border-t border-[#dce8f2]/10 pt-3">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#dce8f2]/60">Sources</p>
                      <ul className="space-y-2">
                        {item.citations.map((citation, citationIndex) => (
                          <li key={citation.id} className="text-xs leading-4">
                            <a href={citation.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 text-[#d9c28f] underline-offset-2 hover:underline">
                              <span>[{citationIndex + 1}] {citation.title}</span><ExternalLink className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span>
                            </a>
                            {/* Each source shows its own review date, not the day of the conversation (DE-20). */}
                            <span className="block text-[11px] text-[#dce8f2]/65">
                              {[citation.publisher, formatReviewed(citation.reviewed_at) && `reviewed ${formatReviewed(citation.reviewed_at)}`].filter(Boolean).join(" · ")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {item.disclaimers?.length > 0 && (
                    <div className="mt-3 flex gap-2 rounded-lg bg-[#142434] p-2 text-[11px] leading-4 text-[#dce8f2]/65"><ShieldCheck className="h-4 w-4 shrink-0 text-[#5e9cd0]" aria-hidden="true" /><span>{item.disclaimers.join(" ")}</span></div>
                  )}
                </article>
              );
            })}
            {loading && <div className="flex items-center gap-2 text-xs text-[#dce8f2]/55"><Loader2 className="h-4 w-4 animate-spin" /> Reviewing authoritative sources…</div>}
          </div>

          <form onSubmit={(event) => { event.preventDefault(); sendMessage(); }} className="border-t border-[#dce8f2]/10 bg-[#142434] p-3">
            <div className="flex items-end gap-2 rounded-xl border border-[#dce8f2]/15 bg-[#142434] p-2 focus-within:border-[#5e9cd0]">
              <textarea ref={promptRef} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} placeholder="Ask a real-estate question…" rows={2} maxLength={6000} className="max-h-28 min-h-12 flex-1 resize-none border-0 bg-transparent px-2 py-1 text-sm outline-none" />
              <button type="submit" disabled={loading || !message.trim()} aria-label="Send message" className="rounded-lg bg-[#5e9cd0] p-3 text-white transition hover:bg-[#7fb3de] disabled:cursor-not-allowed disabled:opacity-40"><Send className="h-4 w-4" /></button>
            </div>
            <p className="mt-2 text-center text-[11px] text-[#dce8f2]/75">Don’t share SSNs, account credentials, or payment-card details.</p>
          </form>
        </section>
      )}

      <button ref={triggerRef} onClick={() => { if (open) closeAssistant(); else setOpen(true); }} aria-expanded={open} aria-label="Ask DiamondEcho assistant" title={compact ? "Ask DiamondEcho" : undefined} data-compact={compact ? "true" : "false"} className={`ml-auto flex h-14 items-center gap-2 border border-[#2d628c]/50 bg-[#0c1826] text-white shadow-xl transition hover:-translate-y-0.5 hover:bg-[#2d628c] ${compact ? "w-14 justify-center px-0" : "px-5"}`}>
        <MessageCircle className="h-5 w-5 text-[#d9c28f]" /><span className={compact ? "sr-only" : "text-[10px] font-semibold uppercase tracking-[0.15em]"}>Ask DiamondEcho</span>
      </button>
    </div>
  );
};

// With no service to answer, the launcher is not offered at all (DE-20).
const RealEstateAssistant = () => (assistantAvailable() ? <AssistantPanel /> : null);

export default RealEstateAssistant;
