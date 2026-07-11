import React, { useEffect } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import Home from "./pages/Home";
import Search from "./pages/Search";
import PropertyDetail from "./pages/PropertyDetail";
import InvestmentCalculator from "./pages/InvestmentCalculator";
import Agents from "./pages/Agents";
import About from "./pages/About";
import RealEstateAssistant from "./components/assistant/RealEstateAssistant";

const ScrollToTop = () => {
  const { pathname, search } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [pathname, search]);
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
          <Route path="/search" element={<Search />} />
          <Route path="/property/:id" element={<PropertyDetail />} />
          <Route path="/investment-calculator" element={<InvestmentCalculator />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/about" element={<About />} />
        </Routes>
        <Footer />
        <RealEstateAssistant />
      </BrowserRouter>
    </div>
  );
}

export default App;
