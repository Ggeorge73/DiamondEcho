import React from 'react';
import { Link } from 'react-router-dom';
import { Diamond, Mail, Phone, MapPin, Facebook, Instagram, Linkedin, Twitter } from 'lucide-react';

const Footer = () => {
  return (
    <footer className="bg-gray-900 text-gray-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Brand */}
          <div>
            <div className="flex items-center space-x-2 mb-4">
              <div className="bg-gradient-to-br from-amber-600 to-amber-700 p-2 rounded-lg">
                <Diamond className="h-5 w-5 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-bold text-white">DiamondEcho</span>
                <span className="text-xs text-gray-400 -mt-1">Realty</span>
              </div>
            </div>
            <p className="text-sm text-gray-400 mb-4">
              Your trusted partner in luxury real estate and investment opportunities.
            </p>
            <div className="flex space-x-3">
              <a href="#" className="text-gray-400 hover:text-amber-500 transition-colors">
                <Facebook className="h-5 w-5" />
              </a>
              <a href="#" className="text-gray-400 hover:text-amber-500 transition-colors">
                <Instagram className="h-5 w-5" />
              </a>
              <a href="#" className="text-gray-400 hover:text-amber-500 transition-colors">
                <Twitter className="h-5 w-5" />
              </a>
              <a href="#" className="text-gray-400 hover:text-amber-500 transition-colors">
                <Linkedin className="h-5 w-5" />
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-white font-semibold mb-4">Quick Links</h3>
            <ul className="space-y-2">
              <li>
                <Link to="/search" className="text-sm hover:text-amber-500 transition-colors">
                  Properties for Sale
                </Link>
              </li>
              <li>
                <Link to="/search?status=rent" className="text-sm hover:text-amber-500 transition-colors">
                  Properties for Rent
                </Link>
              </li>
              <li>
                <Link to="/investment-calculator" className="text-sm hover:text-amber-500 transition-colors">
                  Investment Calculator
                </Link>
              </li>
              <li>
                <Link to="/agents" className="text-sm hover:text-amber-500 transition-colors">
                  Meet Our Agents
                </Link>
              </li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="text-white font-semibold mb-4">Resources</h3>
            <ul className="space-y-2">
              <li>
                <Link to="/about" className="text-sm hover:text-amber-500 transition-colors">
                  About Us
                </Link>
              </li>
              <li>
                <a href="#" className="text-sm hover:text-amber-500 transition-colors">
                  Mortgage Calculator
                </a>
              </li>
              <li>
                <a href="#" className="text-sm hover:text-amber-500 transition-colors">
                  Buyer's Guide
                </a>
              </li>
              <li>
                <a href="#" className="text-sm hover:text-amber-500 transition-colors">
                  Seller's Guide
                </a>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="text-white font-semibold mb-4">Contact Us</h3>
            <ul className="space-y-3">
              <li className="flex items-start space-x-2">
                <MapPin className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <span className="text-sm">123 Luxury Lane, Suite 500<br />New York, NY 10001</span>
              </li>
              <li className="flex items-center space-x-2">
                <Phone className="h-5 w-5 text-amber-500 flex-shrink-0" />
                <span className="text-sm">(555) 123-4567</span>
              </li>
              <li className="flex items-center space-x-2">
                <Mail className="h-5 w-5 text-amber-500 flex-shrink-0" />
                <span className="text-sm">info@diamondecho.com</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-800 mt-8 pt-8 text-center">
          <p className="text-sm text-gray-400">
            © 2025 DiamondEcho Realty. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;