import React, { useEffect } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import Home from "./pages/Home";
import { KeptSearch } from "./pages/Search";
import InvestmentCalculator from "./pages/InvestmentCalculator";
import Agents from "./pages/Agents";
import About from "./pages/About";
import Inquire from "./pages/Inquire";
import NotFound from "./pages/NotFound";
import { Privacy, Terms } from "./pages/Policies";
import Podcast from "./pages/Podcast";
import RealEstateAssistant from "./components/assistant/RealEstateAssistant";
import { BriefAudioProvider } from "./components/BriefAudio";
import PageMeta from "./components/PageMeta";
import { scrollKey, TOOL_PATHS } from "./lib/intelligenceTools";

const ScrollToTop = () => {
  const { pathname, search } = useLocation();
  // Moving between the tools on the Intelligence page keeps the same key, so
  // the page stays where the visitor was.
  const key = scrollKey(pathname, search);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [key]);
  return null;
};

// Everything inside the router. The app wraps it in the browser's router
// below; the build wraps the same thing in a fixed address to save each page
// as HTML (src/prerender.jsx), so the two can never show different pages.
export const Site = () => (
  // The daily brief's player sits above the pages, so the welcome tour
  // keeps playing as the visitor moves around the site.
  <BriefAudioProvider>
    <ScrollToTop />
    <PageMeta />
    <Navbar />
    <Routes>
      <Route path="/" element={<Home />} />
      {/* The search page itself is KeptSearch, below: it stays loaded between visits. */}
      <Route path="/search" element={null} />
      <Route path="/property/:id" element={<Navigate to="/search" replace />} />
      {/* Three addresses, one page: Deal Studio, the mortgage calculator and the
          seller net sheet are tabs of the Intelligence page, and what a visitor
          typed in one is still there after a look at another. */}
      <Route path={TOOL_PATHS.deal} element={<InvestmentCalculator />} />
      <Route path={TOOL_PATHS.mortgage} element={<InvestmentCalculator />} />
      <Route path={TOOL_PATHS["net-proceeds"]} element={<InvestmentCalculator />} />
      <Route path="/agents" element={<Agents />} />
      <Route path="/about" element={<About />} />
      <Route path="/inquire" element={<Inquire />} />
      <Route path="/podcast" element={<Podcast />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
    <KeptSearch />
    <Footer />
    <RealEstateAssistant />
  </BriefAudioProvider>
);

// The browser's router by default. The build passes a router fixed at one
// address instead, and nothing else changes.
function App({ Router = BrowserRouter, ...routerProps }) {
  return (
    <div className="App">
      <Router {...routerProps}>
        <Site />
      </Router>
    </div>
  );
}

export default App;
