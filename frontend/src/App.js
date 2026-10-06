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
import RealEstateAssistant from "./components/assistant/RealEstateAssistant";
import { scrollKey } from "./lib/intelligenceTools";

const ScrollToTop = () => {
  const { pathname, search } = useLocation();
  // Moving between the tools on the Intelligence page keeps the same key, so
  // the page stays where the visitor was.
  const key = scrollKey(pathname, search);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [key]);
  return null;
};

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <ScrollToTop />
        <Navbar />
        <Routes>
          <Route path="/" element={<Home />} />
          {/* The search page itself is KeptSearch, below: it stays loaded between visits. */}
          <Route path="/search" element={null} />
          <Route path="/property/:id" element={<Navigate to="/search" replace />} />
          <Route path="/investment-calculator" element={<InvestmentCalculator />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/about" element={<About />} />
          <Route path="/inquire" element={<Inquire />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <KeptSearch />
        <Footer />
        <RealEstateAssistant />
      </BrowserRouter>
    </div>
  );
}

export default App;
