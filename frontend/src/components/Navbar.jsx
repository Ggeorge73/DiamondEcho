import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Diamond, Menu, X, Search } from 'lucide-react';
import { Button } from './ui/button';

const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/98 backdrop-blur-md shadow-md border-b border-gray-100">
      <div className="w-full px-6 lg:px-12">
        <div className="flex justify-between items-center h-24">
          {/* Logo - Extreme Left */}
          <Link to="/" className="flex items-center space-x-3 group">
            <div className="bg-[#002349] p-3 rounded-lg transform group-hover:scale-105 transition-transform duration-300 shadow-xl">
              <Diamond className="h-7 w-7 text-[#BD9042]" />
            </div>
            <div className="flex flex-col">
              <span className="text-2xl font-bold text-[#002349] tracking-tight">DiamondEcho</span>
              <span className="text-xs text-[#BD9042] -mt-1 tracking-widest font-semibold">REALTY</span>
            </div>
          </Link>

          {/* Desktop Navigation - Center */}
          <div className="hidden lg:flex items-center space-x-10 flex-1 justify-center">
            <Link to="/search" className="text-[#002349] hover:text-[#BD9042] font-bold transition-colors duration-200 text-base tracking-wider">
              BUY
            </Link>
            <Link to="/search?status=rent" className="text-[#002349] hover:text-[#BD9042] font-bold transition-colors duration-200 text-base tracking-wider">
              RENT
            </Link>
            <Link to="/investment-calculator" className="text-[#002349] hover:text-[#BD9042] font-bold transition-colors duration-200 text-base tracking-wider">
              INVEST
            </Link>
            <Link to="/agents" className="text-[#002349] hover:text-[#BD9042] font-bold transition-colors duration-200 text-base tracking-wider">
              AGENTS
            </Link>
            <Link to="/about" className="text-[#002349] hover:text-[#BD9042] font-bold transition-colors duration-200 text-base tracking-wider">
              ABOUT
            </Link>
          </div>

          {/* CTA Buttons - Extreme Right */}
          <div className="hidden lg:flex items-center space-x-4">
            <Button variant="ghost" onClick={() => navigate('/search')} className="text-[#002349] hover:text-[#BD9042] hover:bg-transparent font-bold text-base tracking-wider">
              <Search className="h-5 w-5 mr-2" />
              SEARCH
            </Button>
            <Button className="bg-[#002349] hover:bg-[#003366] text-white shadow-lg font-bold text-base tracking-wide px-8 py-5">
              CONTACT US
            </Button>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="lg:hidden text-[#002349] hover:text-[#BD9042] transition-colors"
          >
            {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMenuOpen && (
        <div className="md:hidden bg-white border-t border-gray-200">
          <div className="px-4 py-6 space-y-4">
            <Link to="/search" className="block text-[#002349] hover:text-[#BD9042] font-bold py-2 text-base tracking-wider" onClick={() => setIsMenuOpen(false)}>
              BUY
            </Link>
            <Link to="/search?status=rent" className="block text-[#002349] hover:text-[#BD9042] font-bold py-2 text-base tracking-wider" onClick={() => setIsMenuOpen(false)}>
              RENT
            </Link>
            <Link to="/investment-calculator" className="block text-[#002349] hover:text-[#BD9042] font-bold py-2 text-base tracking-wider" onClick={() => setIsMenuOpen(false)}>
              INVEST
            </Link>
            <Link to="/agents" className="block text-[#002349] hover:text-[#BD9042] font-bold py-2 text-base tracking-wider" onClick={() => setIsMenuOpen(false)}>
              AGENTS
            </Link>
            <Link to="/about" className="block text-[#002349] hover:text-[#BD9042] font-bold py-2 text-base tracking-wider" onClick={() => setIsMenuOpen(false)}>
              ABOUT
            </Link>
            <div className="flex flex-col space-y-2 pt-4">
              <Button variant="outline" onClick={() => { navigate('/search'); setIsMenuOpen(false); }} className="border-[#002349] text-[#002349] hover:bg-gray-50">
                <Search className="h-4 w-4 mr-2" />
                Search
              </Button>
              <Button className="bg-[#002349] hover:bg-[#003366] text-white">
                Contact Us
              </Button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;