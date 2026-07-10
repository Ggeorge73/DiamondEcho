import React from "react";
import "./App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import Home from "./pages/Home";
import Search from "./pages/Search";
import PropertyDetail from "./pages/PropertyDetail";
import InvestmentCalculator from "./pages/InvestmentCalculator";
import Agents from "./pages/Agents";
import About from "./pages/About";
import RealEstateAssistant from "./components/assistant/RealEstateAssistant";

function App() {
  return (
    <div className="App">
      <BrowserRouter>
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
