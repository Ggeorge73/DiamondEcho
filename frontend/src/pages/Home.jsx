import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Home as HomeIcon, TrendingUp, Calculator, ChevronRight, Star } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { featuredProperties, neighborhoods, testimonials } from '../data/mockData';

const Home = () => {
  const navigate = useNavigate();
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
    }, 5000);
    
    return () => clearInterval(interval);
  }, []);

  const formatPrice = (price) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(price);
  };

  return (
    <div className="min-h-screen">
      {/* Hero Section with Cinematic Video-like Slideshow */}
      <section className="relative h-[calc(100vh+200px)] min-h-[900px] flex items-center justify-center overflow-hidden">
        {/* Image Slideshow Background with Cinematic Movement */}
        {heroImages.map((image, index) => (
          <div
            key={index}
            className={`absolute inset-0 transition-opacity duration-[2500ms] ease-in-out ${
              index === currentSlide ? 'opacity-100' : 'opacity-0'
            }`}
            style={{
              backgroundImage: `url(${image})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              transform: index === currentSlide ? 'scale(1.15)' : 'scale(1.05)',
              transition: 'opacity 2.5s ease-in-out, transform 25s ease-out',
              animation: index === currentSlide ? 'cinematicZoomPan 25s ease-out forwards' : 'none',
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-b from-[#002349]/60 via-[#002349]/40 to-[#002349]/75"></div>
          </div>
        ))}
        
        <div className="relative z-10 max-w-5xl mx-auto px-4 text-center">
          <h1 className="text-6xl md:text-8xl font-bold text-white mb-6 leading-tight animate-fade-in tracking-tight">
            Discover Exceptional Properties
          </h1>
          <p className="text-xl md:text-3xl text-gray-100 animate-fade-in font-light tracking-wide">
            Where luxury real estate meets investment excellence
          </p>
        </div>

        {/* Slideshow Indicators */}
        <div className="absolute bottom-12 left-1/2 transform -translate-x-1/2 flex space-x-2 z-20">
          {heroImages.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentSlide(index)}
              className={`h-1 rounded-full transition-all duration-300 ${
                index === currentSlide 
                  ? 'bg-[#BD9042] w-12' 
                  : 'bg-white/40 w-8 hover:bg-white/60'
              }`}
            />
          ))}
        </div>

        {/* Scroll Indicator */}
        <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-20 animate-bounce">
          <div className="w-6 h-10 border-2 border-white/50 rounded-full flex items-start justify-center p-2">
            <div className="w-1 h-3 bg-white/70 rounded-full animate-pulse"></div>
          </div>
        </div>
      </section>

      {/* Search Bar Section */}
      <section className="bg-gray-50 py-12 -mt-24 relative z-20">
        <div className="max-w-5xl mx-auto px-4">
          <div className="bg-white rounded-lg shadow-2xl p-8 border border-gray-100">
            <div className="flex flex-col md:flex-row gap-4">
              <input
                type="text"
                placeholder="Search by city, neighborhood, or ZIP code"
                className="flex-1 px-6 py-4 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#002349] focus:border-transparent text-gray-900"
              />
              <Button 
                onClick={() => navigate('/search')}
                className="bg-[#002349] hover:bg-[#003366] text-white px-10 py-4 rounded-lg h-auto text-base font-medium tracking-wide shadow-md"
              >
                <Search className="mr-2 h-5 w-5" />
                SEARCH
              </Button>
            </div>
            <div className="flex flex-wrap gap-6 mt-5 justify-center">
              <Button variant="ghost" onClick={() => navigate('/search')} className="text-[#002349] hover:text-[#BD9042] hover:bg-transparent font-medium text-sm tracking-wide">
                BUY
              </Button>
              <span className="text-gray-300">|</span>
              <Button variant="ghost" onClick={() => navigate('/search?status=rent')} className="text-[#002349] hover:text-[#BD9042] hover:bg-transparent font-medium text-sm tracking-wide">
                RENT
              </Button>
              <span className="text-gray-300">|</span>
              <Button variant="ghost" onClick={() => navigate('/investment-calculator')} className="text-[#002349] hover:text-[#BD9042] hover:bg-transparent font-medium text-sm tracking-wide">
                INVEST
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl font-bold text-center text-[#002349] mb-4 tracking-tight">
            Why Choose DiamondEcho Realty?
          </h2>
          <p className="text-center text-gray-600 mb-16 text-lg max-w-3xl mx-auto">
            Experience the pinnacle of real estate services with our comprehensive platform
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            <Card className="border border-gray-100 shadow-lg hover:shadow-2xl transition-all duration-500 group">
              <CardContent className="p-10 text-center">
                <div className="w-20 h-20 bg-[#002349] rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform duration-300">
                  <HomeIcon className="h-10 w-10 text-[#BD9042]" />
                </div>
                <h3 className="text-2xl font-bold text-[#002349] mb-4">Luxury Properties</h3>
                <p className="text-gray-600 leading-relaxed">
                  Access exclusive listings of premium homes, estates, and investment opportunities.
                </p>
              </CardContent>
            </Card>

            <Card className="border border-gray-100 shadow-lg hover:shadow-2xl transition-all duration-500 group">
              <CardContent className="p-10 text-center">
                <div className="w-20 h-20 bg-[#002349] rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform duration-300">
                  <Calculator className="h-10 w-10 text-[#BD9042]" />
                </div>
                <h3 className="text-2xl font-bold text-[#002349] mb-4">Investment Tools</h3>
                <p className="text-gray-600 leading-relaxed">
                  Advanced fix & flip calculator and analysis tools to maximize your ROI.
                </p>
              </CardContent>
            </Card>

            <Card className="border border-gray-100 shadow-lg hover:shadow-2xl transition-all duration-500 group">
              <CardContent className="p-10 text-center">
                <div className="w-20 h-20 bg-[#002349] rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform duration-300">
                  <TrendingUp className="h-10 w-10 text-[#BD9042]" />
                </div>
                <h3 className="text-2xl font-bold text-[#002349] mb-4">Expert Guidance</h3>
                <p className="text-gray-600 leading-relaxed">
                  Work with experienced agents who understand luxury markets and investments.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Featured Properties */}
      <section className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center mb-12">
            <div>
              <h2 className="text-4xl font-bold text-[#002349] tracking-tight">Featured Properties</h2>
              <p className="text-gray-600 mt-2">Handpicked exceptional homes</p>
            </div>
            <Button 
              variant="ghost" 
              onClick={() => navigate('/search')}
              className="text-[#002349] hover:text-[#BD9042] hover:bg-transparent font-medium"
            >
              View All
              <ChevronRight className="ml-2 h-5 w-5" />
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {featuredProperties.map((property) => (
              <Card 
                key={property.id} 
                className="cursor-pointer border border-gray-200 shadow-md hover:shadow-2xl transition-all duration-500 hover:-translate-y-2 overflow-hidden group"
                onClick={() => navigate(`/property/${property.id}`)}
              >
                <div className="relative h-56 overflow-hidden">
                  <img 
                    src={property.images[0]} 
                    alt={property.title}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                  />
                  <div className="absolute top-4 right-4 bg-[#002349] text-white px-4 py-1.5 rounded text-xs font-semibold tracking-wide">
                    {property.status}
                  </div>
                </div>
                <CardContent className="p-6">
                  <h3 className="text-2xl font-bold text-[#BD9042] mb-3">
                    {formatPrice(property.price)}
                  </h3>
                  <p className="text-sm text-gray-600 mb-3 flex items-center space-x-4">
                    <span>{property.beds} bd</span>
                    <span>•</span>
                    <span>{property.baths} ba</span>
                    <span>•</span>
                    <span>{property.sqft.toLocaleString()} sqft</span>
                  </p>
                  <p className="text-sm text-[#002349] font-medium mb-2 line-clamp-2">{property.title}</p>
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
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl font-bold text-center text-[#002349] mb-4 tracking-tight">
            Explore Premium Neighborhoods
          </h2>
          <p className="text-center text-gray-600 mb-16 text-lg">
            Discover the finest locations for your next home
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {neighborhoods.map((neighborhood, index) => (
              <Card 
                key={index}
                className="cursor-pointer border border-gray-200 shadow-md hover:shadow-2xl transition-all duration-500 hover:-translate-y-2 overflow-hidden group"
                onClick={() => navigate('/search')}
              >
                <div className="relative h-64">
                  <img 
                    src={neighborhood.image} 
                    alt={neighborhood.name}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#002349]/90 via-[#002349]/40 to-transparent"></div>
                  <div className="absolute bottom-6 left-6 right-6 text-white">
                    <h3 className="text-2xl font-bold mb-1">{neighborhood.name}</h3>
                    <p className="text-sm text-gray-200 mb-3">{neighborhood.city}</p>
                    <p className="text-lg font-semibold text-[#BD9042]">
                      {formatPrice(neighborhood.avgPrice)}
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
      <section className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl font-bold text-center text-[#002349] mb-4 tracking-tight">
            Client Testimonials
          </h2>
          <p className="text-center text-gray-600 mb-16 text-lg">
            Hear from those who've experienced our exceptional service
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {testimonials.map((testimonial) => (
              <Card key={testimonial.id} className="border border-gray-200 shadow-md hover:shadow-xl transition-shadow duration-300">
                <CardContent className="p-8">
                  <div className="flex mb-5">
                    {[...Array(testimonial.rating)].map((_, i) => (
                      <Star key={i} className="h-5 w-5 text-[#BD9042] fill-current" />
                    ))}
                  </div>
                  <p className="text-gray-700 mb-6 italic leading-relaxed">
                    "{testimonial.content}"
                  </p>
                  <div className="border-t border-gray-200 pt-6">
                    <p className="font-bold text-[#002349]">{testimonial.name}</p>
                    <p className="text-sm text-gray-600">{testimonial.role}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-[#002349] text-white">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-4xl md:text-5xl font-bold mb-6 tracking-tight">
            Ready to Find Your Perfect Property?
          </h2>
          <p className="text-xl text-gray-300 mb-10 font-light">
            Let our expert agents guide you through every step of your real estate journey.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button 
              onClick={() => navigate('/search')}
              size="lg"
              className="bg-[#BD9042] hover:bg-[#A67C35] text-white text-base px-10 py-6 h-auto font-semibold tracking-wide shadow-lg"
            >
              Browse Properties
            </Button>
            <Button 
              onClick={() => navigate('/investment-calculator')}
              size="lg"
              variant="outline"
              className="border-2 border-white text-white hover:bg-white/10 text-base px-10 py-6 h-auto font-semibold tracking-wide"
            >
              Investment Calculator
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;
