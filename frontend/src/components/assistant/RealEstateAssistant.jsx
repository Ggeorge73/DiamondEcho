import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Bot, ExternalLink, Loader2, MessageCircle, Send, ShieldCheck, X } from "lucide-react";

const QUICK_PROMPTS = [
  "Help me plan a home purchase",
  "Analyze a rental property",
  "What should I compare in a mortgage?",
];

const RealEstateAssistant = () => {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [state, setState] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([]);
  const backendUrl = useMemo(() => (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, ""), []);

  useEffect(() => {
    const openAssistant = () => setOpen(true);
    window.addEventListener("open-diamond-assistant", openAssistant);
    return () => window.removeEventListener("open-diamond-assistant", openAssistant);
  }, []);

  const sendMessage = async (text = message) => {
    const clean = text.trim();
    if (!clean || loading) return;
    const userMessage = { role: "user", content: clean };
    const history = [...messages, userMessage];
    setMessages(history);
    setMessage("");
    setLoading(true);
    try {
      const { data } = await axios.post(`${backendUrl}/api/assistant/chat`, {
        message: clean,
        jurisdiction: { country: "US", state: state.trim() || null },
        history: history.slice(-8).map(({ role, content }) => ({ role, content })),
      });
      setMessages((current) => [...current, { role: "assistant", content: data.answer, ...data }]);
    } catch {
      setMessages((current) => [...current, {
        role: "assistant",
        content: "I couldn’t reach the real-estate knowledge service. Please try again or request a human specialist.",
        citations: [],
        disclaimers: [],
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-[70] font-sans">
      {open && (
        <section
          aria-label="DiamondEcho real estate assistant"
          className="mb-4 flex h-[min(720px,calc(100vh-7rem))] w-[min(430px,calc(100vw-2rem))] flex-col overflow-hidden border border-[#2d628c]/35 bg-[#0f1c2a] shadow-2xl"
        >
          <header className="flex items-center justify-between bg-[#0c1826] px-5 py-4 text-white">
            <div className="flex items-center gap-3">
              <span className="rounded-full border border-[#5e9cd0]/60 bg-[#5e9cd0]/10 p-2"><Bot className="h-5 w-5 text-[#a9c7e0]" /></span>
              <div>
                <h2 className="font-serif text-lg tracking-wide">Property Intelligence</h2>
                <p className="text-xs text-white/65">Grounded guidance · cited sources</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close assistant" className="rounded-full p-2 hover:bg-white/10"><X className="h-5 w-5" /></button>
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
            {messages.map((item, index) => (
              <article key={`${item.role}-${index}`} className={item.role === "user" ? "ml-10 rounded-2xl rounded-br-sm bg-[#2d628c] px-4 py-3 text-sm leading-6 text-white" : "mr-5 rounded-2xl rounded-bl-sm border border-[#dce8f2]/10 bg-[#142434] px-4 py-3 text-sm leading-6 text-[#dce8f2]"}>
                <p className="whitespace-pre-wrap">{item.content}</p>
                {item.citations?.length > 0 && (
                  <div className="mt-3 border-t border-[#dce8f2]/10 pt-3">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#dce8f2]/50">Sources · reviewed {item.as_of}</p>
                    <div className="space-y-1">
                      {item.citations.map((citation, citationIndex) => (
                        <a key={citation.id} href={citation.url} target="_blank" rel="noreferrer" className="flex items-start gap-1 text-xs text-[#7C5A19] underline-offset-2 hover:underline">
                          <span>[{citationIndex + 1}] {citation.title}</span><ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                {item.disclaimers?.length > 0 && (
                  <div className="mt-3 flex gap-2 rounded-lg bg-[#142434] p-2 text-[11px] leading-4 text-[#dce8f2]/65"><ShieldCheck className="h-4 w-4 shrink-0 text-[#5e9cd0]" /><span>{item.disclaimers.join(" ")}</span></div>
                )}
              </article>
            ))}
            {loading && <div className="flex items-center gap-2 text-xs text-[#dce8f2]/55"><Loader2 className="h-4 w-4 animate-spin" /> Reviewing authoritative sources…</div>}
          </div>

          <form onSubmit={(event) => { event.preventDefault(); sendMessage(); }} className="border-t border-[#dce8f2]/10 bg-[#142434] p-3">
            <div className="flex items-end gap-2 rounded-xl border border-[#dce8f2]/15 bg-[#142434] p-2 focus-within:border-[#5e9cd0]">
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} placeholder="Ask a real-estate question…" rows={2} maxLength={6000} className="max-h-28 min-h-12 flex-1 resize-none border-0 bg-transparent px-2 py-1 text-sm outline-none" />
              <button type="submit" disabled={loading || !message.trim()} aria-label="Send message" className="rounded-lg bg-[#5e9cd0] p-3 text-white transition hover:bg-[#7fb3de] disabled:cursor-not-allowed disabled:opacity-40"><Send className="h-4 w-4" /></button>
            </div>
            <p className="mt-2 text-center text-[10px] text-[#dce8f2]/45">Don’t share SSNs, account credentials, or payment-card details.</p>
          </form>
        </section>
      )}

      <button onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label="Open DiamondEcho assistant" className="ml-auto flex h-14 items-center gap-2 border border-[#2d628c]/50 bg-[#0c1826] px-5 text-white shadow-xl transition hover:-translate-y-0.5 hover:bg-[#2d628c]">
        <MessageCircle className="h-5 w-5 text-[#d9c28f]" /><span className="text-[10px] font-semibold uppercase tracking-[0.15em]">Ask DiamondEcho</span>
      </button>
    </div>
  );
};

export default RealEstateAssistant;
