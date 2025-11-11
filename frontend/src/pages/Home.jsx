import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Home as HomeIcon, TrendingUp, Calculator, ChevronRight, Star } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { featuredProperties, neighborhoods, testimonials } from '../data/mockData';

const Home = () => {
  const navigate = useNavigate();

  const formatPrice = (price) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(price);
  };

  const [currentSlide, setCurrentSlide] = React.useState(0);
  
  const heroImages = [
    'https://images.unsplash.com/photo-1505843513577-22bb7d21e455',
    'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9',
    'https://images.unsplash.com/photo-1416331108676-a22ccb276e35',
    'https://images.unsplash.com/photo-1574120582683-1adf79c5dfd5',
    'https://images.unsplash.com/photo-1505843795480-5cfb3c03f6ff'
  ];

  React.useEffect(() => {
    const interval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % heroImages.length);
    }, 5000); // Change image every 5 seconds
    
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen">
      {/* Hero Section with Video-like Slideshow */}
      <section className="relative h-[600px] flex items-center justify-center overflow-hidden">
        {/* Image Slideshow Background */}
        {heroImages.map((image, index) => (
          <div
            key={index}
            className={`absolute inset-0 bg-cover bg-center transition-opacity duration-2000 ease-in-out ${
              index === currentSlide ? 'opacity-100' : 'opacity-0'
            }`}
            style={{
              backgroundImage: `url(${image})`,
              transform: index === currentSlide ? 'scale(1.1)' : 'scale(1)',
              transition: 'opacity 2s ease-in-out, transform 20s ease-out',
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-gray-900/80 to-gray-900/40"></div>
          </div>
        ))}
        
        <div className="relative z-10 max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-5xl md:text-6xl font-bold text-white mb-6 leading-tight animate-fade-in">
            Discover Your Dream Home
          </h1>
          <p className="text-xl text-gray-200 mb-8 animate-fade-in">
            Luxury real estate & investment opportunities that exceed expectations
          </p>
          
          {/* Search Bar */}
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-3xl mx-auto animate-fade-in">
            <div className="flex flex-col md:flex-row gap-4">
              <input
                type="text"
                placeholder="City, neighborhood, or ZIP code"
                className="flex-1 px-6 py-4 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 text-gray-900"
              />
              <Button 
                onClick={() => navigate('/search')}
                className="bg-amber-700 hover:bg-amber-800 text-white px-8 py-4 rounded-xl h-auto text-lg font-semibold"
              >
                <Search className="mr-2 h-5 w-5" />
                Search
              </Button>
            </div>
            <div className="flex flex-wrap gap-4 mt-4 justify-center">
              <Button variant="ghost" onClick={() => navigate('/search')} className="text-gray-700 hover:text-amber-700">
                Buy
              </Button>
              <Button variant="ghost" onClick={() => navigate('/search?status=rent')} className="text-gray-700 hover:text-amber-700">
                Rent
              </Button>
              <Button variant="ghost" onClick={() => navigate('/investment-calculator')} className="text-gray-700 hover:text-amber-700">
                Investment Tools
              </Button>
            </div>
          </div>
        </div>

        {/* Slideshow Indicators */}
        <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 flex space-x-2 z-20">
          {heroImages.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentSlide(index)}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                index === currentSlide 
                  ? 'bg-white w-8' 
                  : 'bg-white/50 hover:bg-white/75'
              }`}
            />
          ))}
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl font-bold text-center text-gray-900 mb-12">
            Why Choose DiamondEcho Realty?
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card className="border-none shadow-lg hover:shadow-xl transition-shadow duration-300">
              <CardContent className="p-8 text-center">
                <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <HomeIcon className="h-8 w-8 text-amber-700" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">Luxury Properties</h3>
                <p className="text-gray-600">
                  Access exclusive listings of premium homes, estates, and investment opportunities.
                </p>
              </CardContent>
            </Card>

            <Card className="border-none shadow-lg hover:shadow-xl transition-shadow duration-300">
              <CardContent className="p-8 text-center">
                <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Calculator className="h-8 w-8 text-amber-700" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">Investment Tools</h3>
                <p className="text-gray-600">
                  Advanced fix & flip calculator and analysis tools to maximize your ROI.
                </p>
              </CardContent>
            </Card>

            <Card className="border-none shadow-lg hover:shadow-xl transition-shadow duration-300">
              <CardContent className="p-8 text-center">
                <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <TrendingUp className="h-8 w-8 text-amber-700" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">Expert Guidance</h3>
                <p className="text-gray-600">
                  Work with experienced agents who understand luxury markets and investments.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Featured Properties */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center mb-12">
            <h2 className="text-4xl font-bold text-gray-900">Featured Properties</h2>
            <Button 
              variant="outline" 
              onClick={() => navigate('/search')}
              className="border-amber-700 text-amber-700 hover:bg-amber-50"
            >
              View All
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {featuredProperties.map((property) => (
              <Card 
                key={property.id} 
                className="cursor-pointer border-none shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1 overflow-hidden"
                onClick={() => navigate(`/property/${property.id}`)}
              >
                <div className="relative h-48 overflow-hidden">
                  <img 
                    src={property.images[0]} 
                    alt={property.title}
                    className="w-full h-full object-cover hover:scale-110 transition-transform duration-500"
                  />
                  <div className="absolute top-3 right-3 bg-amber-700 text-white px-3 py-1 rounded-full text-sm font-semibold">
                    {property.status}
                  </div>
                </div>
                <CardContent className="p-5">
                  <h3 className="text-xl font-bold text-amber-700 mb-2">
                    {formatPrice(property.price)}
                  </h3>
                  <p className="text-sm text-gray-600 mb-3">
                    {property.beds} bd | {property.baths} ba | {property.sqft.toLocaleString()} sqft
                  </p>
                  <p className="text-sm text-gray-800 font-medium mb-1">{property.title}</p>
                  <p className="text-sm text-gray-500">
                    {property.city}, {property.state}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Neighborhoods */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl font-bold text-center text-gray-900 mb-12">
            Explore Premium Neighborhoods
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {neighborhoods.map((neighborhood, index) => (
              <Card 
                key={index}
                className="cursor-pointer border-none shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1 overflow-hidden"
                onClick={() => navigate('/search')}
              >
                <div className="relative h-56">
                  <img 
                    src={neighborhood.image} 
                    alt={neighborhood.name}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-gray-900/80 to-transparent"></div>
                  <div className="absolute bottom-4 left-4 right-4 text-white">
                    <h3 className="text-xl font-bold mb-1">{neighborhood.name}</h3>
                    <p className="text-sm text-gray-200 mb-2">{neighborhood.city}</p>
                    <p className="text-lg font-semibold">
                      Avg: {formatPrice(neighborhood.avgPrice)}
                    </p>
                    <p className="text-sm text-gray-300">{neighborhood.properties} properties</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl font-bold text-center text-gray-900 mb-12">
            What Our Clients Say
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {testimonials.map((testimonial) => (
              <Card key={testimonial.id} className="border-none shadow-lg">
                <CardContent className="p-8">
                  <div className="flex mb-4">
                    {[...Array(testimonial.rating)].map((_, i) => (
                      <Star key={i} className="h-5 w-5 text-amber-500 fill-current" />
                    ))}
                  </div>
                  <p className="text-gray-700 mb-6 italic">"{testimonial.content}"</p>
                  <div>
                    <p className="font-bold text-gray-900">{testimonial.name}</p>
                    <p className="text-sm text-gray-600">{testimonial.role}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-gradient-to-br from-amber-600 to-amber-700">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-4xl font-bold text-white mb-6">
            Ready to Find Your Perfect Property?
          </h2>
          <p className="text-xl text-amber-50 mb-8">
            Let our expert agents guide you through every step of your real estate journey.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button 
              onClick={() => navigate('/search')}
              size="lg"
              className="bg-white text-amber-700 hover:bg-gray-100 text-lg px-8 py-6 h-auto font-semibold"
            >
              Browse Properties
            </Button>
            <Button 
              onClick={() => navigate('/investment-calculator')}
              size="lg"
              variant="outline"
              className="border-2 border-white text-white hover:bg-white/10 text-lg px-8 py-6 h-auto font-semibold"
            >
              Try Investment Calculator
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;