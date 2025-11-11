import React from 'react';
import { Phone, Mail, Building } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { agents } from '../data/mockData';

const Agents = () => {
  return (
    <div className="min-h-screen bg-gray-50 pt-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-6xl font-bold text-[#002349] mb-6 tracking-tight">
            Meet Our Expert Agents
          </h1>
          <p className="text-2xl text-gray-600 max-w-3xl mx-auto font-light">
            Our team of experienced professionals is dedicated to helping you achieve your real estate goals.
          </p>
        </div>

        {/* Agents Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
          {agents.map((agent) => (
            <Card key={agent.id} className="border border-gray-200 shadow-lg hover:shadow-2xl transition-all duration-500 hover:-translate-y-1">
              <CardContent className="p-10 text-center">
                <img 
                  src={agent.photo} 
                  alt={agent.name}
                  className="w-36 h-36 rounded-full mx-auto mb-6 object-cover border-4 border-[#BD9042]"
                />
                <h3 className="text-2xl font-bold text-[#002349] mb-2">{agent.name}</h3>
                <p className="text-[#BD9042] font-semibold mb-4 tracking-wide">{agent.title}</p>
                <p className="text-gray-600 mb-6">{agent.bio}</p>
                
                <div className="space-y-2 mb-6">
                  <div className="flex items-center justify-center text-gray-700">
                    <Phone className="h-4 w-4 mr-2 text-amber-700" />
                    <span className="text-sm">{agent.phone}</span>
                  </div>
                  <div className="flex items-center justify-center text-gray-700">
                    <Mail className="h-4 w-4 mr-2 text-amber-700" />
                    <span className="text-sm">{agent.email}</span>
                  </div>
                  <div className="flex items-center justify-center text-gray-700">
                    <Building className="h-4 w-4 mr-2 text-amber-700" />
                    <span className="text-sm">{agent.listings} Active Listings</span>
                  </div>
                </div>

                <div className="flex flex-col space-y-2">
                  <Button className="bg-amber-700 hover:bg-amber-800">
                    Contact Agent
                  </Button>
                  <Button variant="outline" className="border-amber-700 text-amber-700 hover:bg-amber-50">
                    View Listings
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Agents;