import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Diamond, Menu, X, Search } from 'lucide-react';
import { Button } from './ui/button';

const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-sm shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-20">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-2 group">
            <div className="bg-gradient-to-br from-amber-600 to-amber-700 p-2 rounded-lg transform group-hover:scale-105 transition-transform duration-300">
              <Diamond className="h-6 w-6 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-bold text-gray-900">DiamondEcho</span>
              <span className="text-xs text-gray-600 -mt-1">Realty</span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-8">
            <Link to="/search" className="text-gray-700 hover:text-amber-700 font-medium transition-colors duration-200">
              Buy
            </Link>
            <Link to="/search?status=rent" className="text-gray-700 hover:text-amber-700 font-medium transition-colors duration-200">
              Rent
            </Link>
            <Link to="/investment-calculator" className="text-gray-700 hover:text-amber-700 font-medium transition-colors duration-200">
              Investment Tools
            </Link>
            <Link to="/agents" className="text-gray-700 hover:text-amber-700 font-medium transition-colors duration-200">
              Our Agents
            </Link>
            <Link to="/about" className="text-gray-700 hover:text-amber-700 font-medium transition-colors duration-200">
              About
            </Link>
          </div>

          {/* CTA Buttons */}
          <div className="hidden md:flex items-center space-x-4">
            <Button variant="outline" onClick={() => navigate('/search')}>
              <Search className="h-4 w-4 mr-2" />
              Search
            </Button>
            <Button className="bg-amber-700 hover:bg-amber-800 text-white">
              Contact Us
            </Button>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="md:hidden text-gray-700 hover:text-amber-700 transition-colors"
          >
            {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMenuOpen && (
        <div className="md:hidden bg-white border-t border-gray-200">
          <div className="px-4 py-6 space-y-4">
            <Link to="/search" className="block text-gray-700 hover:text-amber-700 font-medium py-2" onClick={() => setIsMenuOpen(false)}>
              Buy
            </Link>
            <Link to="/search?status=rent" className="block text-gray-700 hover:text-amber-700 font-medium py-2" onClick={() => setIsMenuOpen(false)}>
              Rent
            </Link>
            <Link to="/investment-calculator" className="block text-gray-700 hover:text-amber-700 font-medium py-2" onClick={() => setIsMenuOpen(false)}>
              Investment Tools
            </Link>
            <Link to="/agents" className="block text-gray-700 hover:text-amber-700 font-medium py-2" onClick={() => setIsMenuOpen(false)}>
              Our Agents
            </Link>
            <Link to="/about" className="block text-gray-700 hover:text-amber-700 font-medium py-2" onClick={() => setIsMenuOpen(false)}>
              About
            </Link>
            <div className="flex flex-col space-y-2 pt-4">
              <Button variant="outline" onClick={() => { navigate('/search'); setIsMenuOpen(false); }}>
                <Search className="h-4 w-4 mr-2" />
                Search
              </Button>
              <Button className="bg-amber-700 hover:bg-amber-800 text-white">
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