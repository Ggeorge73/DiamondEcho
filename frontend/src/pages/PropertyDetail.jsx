import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Bed, Bath, Square, Calendar, MapPin, Heart, Share2, Phone, Mail, Calculator as CalcIcon } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { properties, agents } from '../data/mockData';

const PropertyDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [selectedImage, setSelectedImage] = useState(0);
  const property = properties.find(p => p.id === parseInt(id));
  const agent = agents[0]; // Assign first agent as listing agent

  if (!property) {
    return (
      <div className="min-h-screen bg-gray-50 pt-20 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Property Not Found</h2>
          <Button onClick={() => navigate('/search')} className="bg-amber-700 hover:bg-amber-800">
            Back to Search
          </Button>
        </div>
      </div>
    );
  }

  const formatPrice = (price) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(price);
  };

  return (
    <div className="min-h-screen bg-gray-50 pt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back Button */}
        <Button 
          variant="ghost" 
          onClick={() => navigate('/search')}
          className="mb-6 hover:bg-gray-100"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Search
        </Button>

        {/* Image Gallery */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-8">
          <div className="lg:col-span-3">
            <div className="relative h-[500px] rounded-xl overflow-hidden shadow-lg">
              <img 
                src={property.images[selectedImage]} 
                alt={property.title}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="grid grid-cols-3 gap-4 mt-4">
              {property.images.map((image, index) => (
                <div 
                  key={index}
                  onClick={() => setSelectedImage(index)}
                  className={`relative h-32 rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${
                    selectedImage === index ? 'border-amber-700' : 'border-transparent hover:border-gray-300'
                  }`}
                >
                  <img 
                    src={image} 
                    alt={`View ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Agent Card */}
          <div className="lg:col-span-1">
            <Card className="border-none shadow-lg sticky top-24">
              <CardContent className="p-6">
                <div className="text-center mb-6">
                  <img 
                    src={agent.photo} 
                    alt={agent.name}
                    className="w-24 h-24 rounded-full mx-auto mb-4 object-cover"
                  />
                  <h3 className="font-bold text-lg text-gray-900">{agent.name}</h3>
                  <p className="text-sm text-gray-600 mb-4">{agent.title}</p>
                </div>

                <div className="space-y-3 mb-6">
                  <Button className="w-full bg-amber-700 hover:bg-amber-800">
                    <Phone className="h-4 w-4 mr-2" />
                    Call Agent
                  </Button>
                  <Button variant="outline" className="w-full border-gray-300 hover:border-amber-700 hover:text-amber-700">
                    <Mail className="h-4 w-4 mr-2" />
                    Send Email
                  </Button>
                  <Button variant="outline" className="w-full border-gray-300 hover:border-amber-700 hover:text-amber-700">
                    Schedule Tour
                  </Button>
                </div>

                <div className="pt-6 border-t border-gray-200">
                  <Button 
                    variant="ghost" 
                    className="w-full justify-start text-gray-700 hover:text-amber-700"
                    onClick={() => navigate('/investment-calculator')}
                  >
                    <CalcIcon className="h-4 w-4 mr-2" />
                    Analyze Investment
                  </Button>
                  <Button variant="ghost" className="w-full justify-start text-gray-700 hover:text-amber-700">
                    <Heart className="h-4 w-4 mr-2" />
                    Save Property
                  </Button>
                  <Button variant="ghost" className="w-full justify-start text-gray-700 hover:text-amber-700">
                    <Share2 className="h-4 w-4 mr-2" />
                    Share
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Property Details */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            {/* Header */}
            <div className="bg-white rounded-xl shadow-md p-8 mb-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h1 className="text-4xl font-bold text-gray-900 mb-2">
                    {formatPrice(property.price)}
                  </h1>
                  <div className="flex items-center text-gray-600">
                    <MapPin className="h-5 w-5 mr-2" />
                    <span className="text-lg">
                      {property.address}, {property.city}, {property.state} {property.zip}
                    </span>
                  </div>
                </div>
                <div className="bg-amber-100 text-amber-800 px-4 py-2 rounded-full font-semibold">
                  {property.status}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-6 mt-6 pt-6 border-t border-gray-200">
                <div className="text-center">
                  <div className="flex justify-center items-center mb-2">
                    <Bed className="h-6 w-6 text-amber-700" />
                  </div>
                  <div className="text-2xl font-bold text-gray-900">{property.beds}</div>
                  <div className="text-sm text-gray-600">Bedrooms</div>
                </div>
                <div className="text-center">
                  <div className="flex justify-center items-center mb-2">
                    <Bath className="h-6 w-6 text-amber-700" />
                  </div>
                  <div className="text-2xl font-bold text-gray-900">{property.baths}</div>
                  <div className="text-sm text-gray-600">Bathrooms</div>
                </div>
                <div className="text-center">
                  <div className="flex justify-center items-center mb-2">
                    <Square className="h-6 w-6 text-amber-700" />
                  </div>
                  <div className="text-2xl font-bold text-gray-900">{property.sqft.toLocaleString()}</div>
                  <div className="text-sm text-gray-600">Sqft</div>
                </div>
                <div className="text-center">
                  <div className="flex justify-center items-center mb-2">
                    <Calendar className="h-6 w-6 text-amber-700" />
                  </div>
                  <div className="text-2xl font-bold text-gray-900">{property.yearBuilt}</div>
                  <div className="text-sm text-gray-600">Year Built</div>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="overview" className="bg-white rounded-xl shadow-md p-8">
              <TabsList className="grid w-full grid-cols-4 mb-6">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="features">Features</TabsTrigger>
                <TabsTrigger value="neighborhood">Neighborhood</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-6">
                <div>
                  <h3 className="text-xl font-bold text-gray-900 mb-4">Description</h3>
                  <p className="text-gray-700 leading-relaxed">{property.description}</p>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900 mb-4">Property Details</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex justify-between py-2 border-b border-gray-200">
                      <span className="text-gray-600">Property Type:</span>
                      <span className="font-semibold text-gray-900">{property.propertyType}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-gray-200">
                      <span className="text-gray-600">Year Built:</span>
                      <span className="font-semibold text-gray-900">{property.yearBuilt}</span>
                    </div>
                    {property.lotSize && (
                      <div className="flex justify-between py-2 border-b border-gray-200">
                        <span className="text-gray-600">Lot Size:</span>
                        <span className="font-semibold text-gray-900">{property.lotSize.toLocaleString()} sqft</span>
                      </div>
                    )}
                    <div className="flex justify-between py-2 border-b border-gray-200">
                      <span className="text-gray-600">Price/Sqft:</span>
                      <span className="font-semibold text-gray-900">${Math.round(property.price / property.sqft)}</span>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="features" className="space-y-4">
                <h3 className="text-xl font-bold text-gray-900 mb-4">Property Features</h3>
                <div className="grid grid-cols-2 gap-4">
                  {property.features.map((feature, index) => (
                    <div key={index} className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-amber-700 rounded-full"></div>
                      <span className="text-gray-700">{feature}</span>
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="neighborhood" className="space-y-6">
                <div>
                  <h3 className="text-xl font-bold text-gray-900 mb-4">Neighborhood Info</h3>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center py-3 border-b border-gray-200">
                      <span className="text-gray-700">School Rating</span>
                      <span className="font-semibold text-gray-900">{property.schoolRating}/10</span>
                    </div>
                    <div className="flex justify-between items-center py-3 border-b border-gray-200">
                      <span className="text-gray-700">Walk Score</span>
                      <span className="font-semibold text-gray-900">{property.walkScore}/100</span>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="history" className="space-y-6">
                <div>
                  <h3 className="text-xl font-bold text-gray-900 mb-4">Price History</h3>
                  <div className="space-y-3">
                    {property.priceHistory.map((entry, index) => (
                      <div key={index} className="flex justify-between py-2 border-b border-gray-200">
                        <span className="text-gray-700">{entry.date} - {entry.event}</span>
                        <span className="font-semibold text-gray-900">{formatPrice(entry.price)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900 mb-4">Tax History</h3>
                  <div className="space-y-3">
                    {property.taxHistory.map((entry, index) => (
                      <div key={index} className="flex justify-between py-2 border-b border-gray-200">
                        <span className="text-gray-700">{entry.year}</span>
                        <span className="font-semibold text-gray-900">{formatPrice(entry.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1">
            <Card className="border-none shadow-lg mb-6">
              <CardContent className="p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Mortgage Calculator</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Purchase Price</label>
                    <input 
                      type="text" 
                      value={formatPrice(property.price)}
                      readOnly
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Down Payment (20%)</label>
                    <input 
                      type="text" 
                      value={formatPrice(property.price * 0.2)}
                      readOnly
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Interest Rate</label>
                    <input 
                      type="text" 
                      value="7.5%"
                      readOnly
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-900"
                    />
                  </div>
                  <div className="pt-4 border-t border-gray-200">
                    <div className="flex justify-between mb-2">
                      <span className="text-gray-700">Est. Monthly Payment</span>
                      <span className="text-xl font-bold text-amber-700">
                        {formatPrice((property.price * 0.8 * 0.075 / 12) / (1 - Math.pow(1 + 0.075/12, -360)))}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">Principal & Interest only</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PropertyDetail;