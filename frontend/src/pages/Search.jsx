import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search as SearchIcon, SlidersHorizontal, MapPin, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { properties } from '../data/mockData';

const Search = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    propertyType: 'all',
    minPrice: '',
    maxPrice: '',
    beds: '',
    baths: '',
    minSqft: '',
    maxSqft: ''
  });

  const formatPrice = (price) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(price);
  };

  const filteredProperties = useMemo(() => {
    return properties.filter(property => {
      const matchesSearch = searchTerm === '' || 
        property.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
        property.state.toLowerCase().includes(searchTerm.toLowerCase()) ||
        property.zip.includes(searchTerm) ||
        property.title.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesType = filters.propertyType === 'all' || property.propertyType === filters.propertyType;
      const matchesMinPrice = !filters.minPrice || property.price >= parseInt(filters.minPrice);
      const matchesMaxPrice = !filters.maxPrice || property.price <= parseInt(filters.maxPrice);
      const matchesBeds = !filters.beds || property.beds >= parseInt(filters.beds);
      const matchesBaths = !filters.baths || property.baths >= parseFloat(filters.baths);
      const matchesMinSqft = !filters.minSqft || property.sqft >= parseInt(filters.minSqft);
      const matchesMaxSqft = !filters.maxSqft || property.sqft <= parseInt(filters.maxSqft);

      return matchesSearch && matchesType && matchesMinPrice && matchesMaxPrice && 
             matchesBeds && matchesBaths && matchesMinSqft && matchesMaxSqft;
    });
  }, [searchTerm, filters]);

  const clearFilters = () => {
    setFilters({
      propertyType: 'all',
      minPrice: '',
      maxPrice: '',
      beds: '',
      baths: '',
      minSqft: '',
      maxSqft: ''
    });
    setSearchTerm('');
  };

  return (
    <div className="min-h-screen bg-gray-50 pt-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Search Header */}
        <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <SearchIcon className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <Input
                type="text"
                placeholder="Search by city, zip code, or address..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-12 py-6 text-lg border-gray-300 focus:ring-[#002349] focus:border-[#002349]"
              />
            </div>
            <Button 
              onClick={() => setShowFilters(!showFilters)}
              variant="outline"
              className="border-[#002349] text-[#002349] hover:bg-[#002349] hover:text-white py-6 px-8 font-bold tracking-wide"
            >
              <SlidersHorizontal className="h-5 w-5 mr-2" />
              FILTERS
            </Button>
          </div>

          {/* Filters Panel */}
          {showFilters && (
            <div className="mt-6 pt-6 border-t border-gray-200">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Property Type</label>
                  <Select value={filters.propertyType} onValueChange={(value) => setFilters({...filters, propertyType: value})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="Single Family">Single Family</SelectItem>
                      <SelectItem value="Condo">Condo</SelectItem>
                      <SelectItem value="Townhouse">Townhouse</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Min Price</label>
                  <Input
                    type="number"
                    placeholder="No min"
                    value={filters.minPrice}
                    onChange={(e) => setFilters({...filters, minPrice: e.target.value})}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Max Price</label>
                  <Input
                    type="number"
                    placeholder="No max"
                    value={filters.maxPrice}
                    onChange={(e) => setFilters({...filters, maxPrice: e.target.value})}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Bedrooms</label>
                  <Select value={filters.beds} onValueChange={(value) => setFilters({...filters, beds: value})}>
                    <SelectTrigger>
                      <SelectValue placeholder="Any" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Any</SelectItem>
                      <SelectItem value="1">1+</SelectItem>
                      <SelectItem value="2">2+</SelectItem>
                      <SelectItem value="3">3+</SelectItem>
                      <SelectItem value="4">4+</SelectItem>
                      <SelectItem value="5">5+</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Bathrooms</label>
                  <Select value={filters.baths} onValueChange={(value) => setFilters({...filters, baths: value})}>
                    <SelectTrigger>
                      <SelectValue placeholder="Any" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Any</SelectItem>
                      <SelectItem value="1">1+</SelectItem>
                      <SelectItem value="2">2+</SelectItem>
                      <SelectItem value="3">3+</SelectItem>
                      <SelectItem value="4">4+</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Min Sqft</label>
                  <Input
                    type="number"
                    placeholder="No min"
                    value={filters.minSqft}
                    onChange={(e) => setFilters({...filters, minSqft: e.target.value})}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Max Sqft</label>
                  <Input
                    type="number"
                    placeholder="No max"
                    value={filters.maxSqft}
                    onChange={(e) => setFilters({...filters, maxSqft: e.target.value})}
                  />
                </div>

                <div className="flex items-end">
                  <Button 
                    onClick={clearFilters}
                    variant="outline"
                    className="w-full border-gray-300 hover:border-red-500 hover:text-red-500"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Clear All
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Results Header */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-[#002349] tracking-tight">
            {filteredProperties.length} Properties Found
          </h2>
          <p className="text-gray-600 mt-2 text-lg">
            {searchTerm && `Results for "${searchTerm}"`}
          </p>
        </div>

        {/* Property Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredProperties.map((property) => (
            <Card 
              key={property.id} 
              className="cursor-pointer border border-gray-200 shadow-md hover:shadow-2xl transition-all duration-500 hover:-translate-y-2 overflow-hidden group"
              onClick={() => navigate(`/property/${property.id}`)}
            >
              <div className="relative h-64 overflow-hidden">
                <img 
                  src={property.images[0]} 
                  alt={property.title}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                />
                <div className="absolute top-4 right-4 bg-[#002349] text-white px-4 py-1.5 rounded text-xs font-bold tracking-wide">
                  {property.status}
                </div>
              </div>
              <CardContent className="p-6">
                <h3 className="text-2xl font-bold text-[#BD9042] mb-3">
                  {formatPrice(property.price)}
                </h3>
                <div className="flex items-center text-gray-600 mb-3">
                  <span className="mr-4">{property.beds} bd</span>
                  <span className="mr-4">{property.baths} ba</span>
                  <span>{property.sqft.toLocaleString()} sqft</span>
                </div>
                <p className="text-gray-800 font-medium mb-2">{property.title}</p>
                <div className="flex items-start text-gray-600">
                  <MapPin className="h-4 w-4 mr-1 mt-1 flex-shrink-0" />
                  <span className="text-sm">
                    {property.address}, {property.city}, {property.state} {property.zip}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {filteredProperties.length === 0 && (
          <div className="text-center py-16">
            <div className="text-gray-400 mb-4">
              <SearchIcon className="h-16 w-16 mx-auto" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              No properties found
            </h3>
            <p className="text-gray-600 mb-6">
              Try adjusting your search criteria or filters
            </p>
            <Button onClick={clearFilters} className="bg-amber-700 hover:bg-amber-800">
              Clear Filters
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Search;