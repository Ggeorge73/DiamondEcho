import React from 'react';
import { Award, Users, TrendingUp, Heart, Shield, Target } from 'lucide-react';
import { Card, CardContent } from '../components/ui/card';

const About = () => {
  const stats = [
    { label: 'Properties Sold', value: '2,500+', icon: TrendingUp },
    { label: 'Happy Clients', value: '1,800+', icon: Users },
    { label: 'Years Experience', value: '15+', icon: Award },
    { label: 'Investment Deals', value: '450+', icon: Target },
  ];

  const values = [
    {
      icon: Heart,
      title: 'Client-Focused',
      description: 'We put our clients first in every decision and transaction, ensuring their goals become our priority.'
    },
    {
      icon: Shield,
      title: 'Integrity',
      description: 'Transparency and honesty guide all our interactions, building trust that lasts beyond the closing.'
    },
    {
      icon: Award,
      title: 'Excellence',
      description: 'We maintain the highest standards in everything we do, from market analysis to customer service.'
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 pt-20">
      {/* Hero Section */}
      <section className="relative h-[500px] flex items-center justify-center overflow-hidden mb-20">
        <div 
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: 'url(https://images.unsplash.com/photo-1600596542815-ffad4c1539a9)',
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-[#002349]/70 via-[#002349]/50 to-[#002349]/80"></div>
        </div>
        
        <div className="relative z-10 max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-6xl md:text-7xl font-bold text-white mb-6 tracking-tight">
            About DiamondEcho Realty
          </h1>
          <p className="text-2xl text-gray-100 font-light">
            Where luxury real estate meets investment excellence
          </p>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        {/* Stats Section */}
        <section className="mb-16">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {stats.map((stat, index) => (
              <Card key={index} className="border-none shadow-lg text-center">
                <CardContent className="p-8">
                  <stat.icon className="h-12 w-12 text-amber-700 mx-auto mb-4" />
                  <div className="text-4xl font-bold text-gray-900 mb-2">{stat.value}</div>
                  <div className="text-gray-600">{stat.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Story Section */}
        <section className="mb-20">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-5xl font-bold text-[#002349] mb-8 tracking-tight">Our Story</h2>
              <div className="space-y-4 text-gray-700 leading-relaxed">
                <p>
                  Founded in 2009, DiamondEcho Realty was born from a vision to revolutionize the real estate industry by combining traditional brokerage excellence with cutting-edge investment tools.
                </p>
                <p>
                  What started as a boutique firm serving luxury home buyers has evolved into a comprehensive platform that serves both residential clients and savvy real estate investors. Our unique dual approach allows us to provide unmatched value to anyone looking to buy, sell, or invest in real estate.
                </p>
                <p>
                  Today, we're proud to be a leader in luxury real estate while also being the go-to resource for fix-and-flip investors seeking data-driven insights and analysis tools.
                </p>
              </div>
            </div>
            <div className="relative h-[400px] rounded-xl overflow-hidden shadow-2xl">
              <img 
                src="https://images.unsplash.com/photo-1505843513577-22bb7d21e455" 
                alt="DiamondEcho office"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </section>

        {/* Values Section */}
        <section className="mb-20">
          <h2 className="text-5xl font-bold text-center text-[#002349] mb-16 tracking-tight">
            Our Values
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {values.map((value, index) => (
              <Card key={index} className="border border-gray-200 shadow-lg hover:shadow-2xl transition-shadow duration-500">
                <CardContent className="p-10 text-center">
                  <div className="w-20 h-20 bg-[#002349] rounded-full flex items-center justify-center mx-auto mb-6">
                    <value.icon className="h-10 w-10 text-[#BD9042]" />
                  </div>
                  <h3 className="text-2xl font-bold text-[#002349] mb-4">{value.title}</h3>
                  <p className="text-gray-600 leading-relaxed">{value.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Mission Section */}
        <section className="mb-16">
          <Card className="border-none shadow-lg bg-gradient-to-br from-amber-600 to-amber-700 text-white">
            <CardContent className="p-12 text-center">
              <h2 className="text-4xl font-bold mb-6">Our Mission</h2>
              <p className="text-xl text-amber-50 max-w-3xl mx-auto leading-relaxed">
                To empower our clients with the tools, knowledge, and expertise they need to make confident real estate decisions—whether they're finding their dream home or building wealth through strategic investments.
              </p>
            </CardContent>
          </Card>
        </section>

        {/* What Makes Us Different */}
        <section>
          <h2 className="text-4xl font-bold text-center text-gray-900 mb-12">
            What Makes Us Different
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Card className="border-none shadow-lg">
              <CardContent className="p-8">
                <h3 className="text-2xl font-bold text-gray-900 mb-4">For Home Buyers & Sellers</h3>
                <ul className="space-y-3 text-gray-700">
                  <li className="flex items-start">
                    <div className="w-2 h-2 bg-amber-700 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                    <span>Exclusive access to luxury properties and off-market listings</span>
                  </li>
                  <li className="flex items-start">
                    <div className="w-2 h-2 bg-amber-700 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                    <span>Advanced property valuation tools and market insights</span>
                  </li>
                  <li className="flex items-start">
                    <div className="w-2 h-2 bg-amber-700 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                    <span>White-glove service throughout the entire transaction</span>
                  </li>
                  <li className="flex items-start">
                    <div className="w-2 h-2 bg-amber-700 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                    <span>Expert negotiation and comprehensive market knowledge</span>
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card className="border-none shadow-lg">
              <CardContent className="p-8">
                <h3 className="text-2xl font-bold text-gray-900 mb-4">For Investors</h3>
                <ul className="space-y-3 text-gray-700">
                  <li className="flex items-start">
                    <div className="w-2 h-2 bg-amber-700 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                    <span>Advanced fix & flip analysis calculator with detailed breakdowns</span>
                  </li>
                  <li className="flex items-start">
                    <div className="w-2 h-2 bg-amber-700 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                    <span>Market comps and ARV analysis tools</span>
                  </li>
                  <li className="flex items-start">
                    <div className="w-2 h-2 bg-amber-700 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                    <span>Deal advisory based on 70% rule and ROI metrics</span>
                  </li>
                  <li className="flex items-start">
                    <div className="w-2 h-2 bg-amber-700 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                    <span>Access to investment-focused agents with proven track records</span>
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </div>
  );
};

export default About;