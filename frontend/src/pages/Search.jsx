import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, Search as SearchIcon, SlidersHorizontal, X } from 'lucide-react';
import { properties } from '../data/mockData';

const formatPrice = (price) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
}).format(price);

const emptyFilters = {
  propertyType: 'all', minPrice: '', maxPrice: '', beds: '', baths: '', minSqft: '', maxSqft: '',
};

const Search = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const isRentals = params.get('status') === 'rent';
  const [searchTerm, setSearchTerm] = useState(params.get('q') || '');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState(emptyFilters);

  useEffect(() => { setSearchTerm(params.get('q') || ''); }, [params]);

  const filteredProperties = useMemo(() => properties.filter((property) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = term === ''
      || property.city.toLowerCase().includes(term)
      || property.state.toLowerCase().includes(term)
      || property.zip.includes(searchTerm)
      || property.title.toLowerCase().includes(term)
      || property.features.some((feature) => feature.toLowerCase().includes(term));

    const matchesType = filters.propertyType === 'all' || property.propertyType === filters.propertyType;
    const matchesMinPrice = !filters.minPrice || property.price >= parseInt(filters.minPrice, 10);
    const matchesMaxPrice = !filters.maxPrice || property.price <= parseInt(filters.maxPrice, 10);
    const matchesBeds = !filters.beds || property.beds >= parseInt(filters.beds, 10);
    const matchesBaths = !filters.baths || property.baths >= parseFloat(filters.baths);
    const matchesMinSqft = !filters.minSqft || property.sqft >= parseInt(filters.minSqft, 10);
    const matchesMaxSqft = !filters.maxSqft || property.sqft <= parseInt(filters.maxSqft, 10);

    return matchesSearch && matchesType && matchesMinPrice && matchesMaxPrice
      && matchesBeds && matchesBaths && matchesMinSqft && matchesMaxSqft;
  }), [searchTerm, filters]);

  const clearFilters = () => { setFilters(emptyFilters); setSearchTerm(''); };
  const setFilter = (key) => (event) => setFilters({ ...filters, [key]: event.target.value });

  return (
    <div className="mf-page">
      <section className="mf-page-hero">
        <div className="mf-page-hero__inner">
          <div>
            <p className="eyebrow">{isRentals ? '02 — Rentals' : '01 — Residences'}</p>
            <h1>{isRentals ? <>Curated <em>rentals.</em></> : <>The private <em>collection.</em></>}</h1>
            <p className="mf-page-hero__lede">
              {isRentals
                ? 'Furnished residences and executive leases held to sale-grade standards — inspected, managed, and represented end to end.'
                : 'Every residence in the collection, searchable on your own terms. Filter by market, price, size, and character — no registration required.'}
            </p>
          </div>
          <div className="mf-page-hero__meta">
            <strong>{properties.length}</strong>
            <span>Listings live</span>
          </div>
        </div>
      </section>

      <div className="mf-searchbar">
        <div>
          <SearchIcon />
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="City, state, zip, feature, or listing name…"
            aria-label="Search properties"
          />
        </div>
        <button className={showFilters ? 'is-active' : ''} onClick={() => setShowFilters(!showFilters)}>
          <SlidersHorizontal /> Filters
        </button>
        <button onClick={() => setShowFilters(false)}>
          Search <ArrowUpRight />
        </button>
      </div>

      {showFilters && (
        <div className="mf-filters">
          <label>
            <span>Property type</span>
            <select value={filters.propertyType} onChange={setFilter('propertyType')}>
              <option value="all">All types</option>
              <option value="Single Family">Single family</option>
              <option value="Condo">Condo</option>
              <option value="Townhouse">Townhouse</option>
            </select>
          </label>
          <label>
            <span>Min price</span>
            <input type="number" placeholder="No min" value={filters.minPrice} onChange={setFilter('minPrice')} />
          </label>
          <label>
            <span>Max price</span>
            <input type="number" placeholder="No max" value={filters.maxPrice} onChange={setFilter('maxPrice')} />
          </label>
          <label>
            <span>Bedrooms</span>
            <select value={filters.beds} onChange={setFilter('beds')}>
              <option value="">Any</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}+</option>)}
            </select>
          </label>
          <label>
            <span>Bathrooms</span>
            <select value={filters.baths} onChange={setFilter('baths')}>
              <option value="">Any</option>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}+</option>)}
            </select>
          </label>
          <label>
            <span>Min sqft</span>
            <input type="number" placeholder="No min" value={filters.minSqft} onChange={setFilter('minSqft')} />
          </label>
          <label>
            <span>Max sqft</span>
            <input type="number" placeholder="No max" value={filters.maxSqft} onChange={setFilter('maxSqft')} />
          </label>
          <button className="mf-filters__clear" onClick={clearFilters}>
            <X /> Clear all
          </button>
        </div>
      )}

      <div className="mf-results-head">
        <h2><i>{filteredProperties.length}</i> {filteredProperties.length === 1 ? 'residence' : 'residences'} found</h2>
        {searchTerm && <p>Results for “{searchTerm}”</p>}
      </div>

      <div className="mf-grid">
        {filteredProperties.map((property, index) => (
          <article
            key={property.id}
            className="mf-prop-card"
            style={{ animationDelay: `${index * 0.05}s` }}
            onClick={() => navigate(`/property/${property.id}`)}
            onKeyDown={(event) => event.key === 'Enter' && navigate(`/property/${property.id}`)}
            role="button"
            tabIndex={0}
          >
            <div className="mf-prop-card__media">
              <img src={`${property.images[0]}?auto=format&fit=crop&w=1200&q=82`} alt={property.title} loading="lazy" />
              <span className="mf-prop-card__status">{property.status}</span>
            </div>
            <div className="mf-prop-card__body">
              <small>{property.address}, {property.city}, {property.state} {property.zip}</small>
              <h3>{property.title}</h3>
              <div className="mf-prop-card__meta">
                <strong>{formatPrice(property.price)}</strong>
                <span>{property.beds} bd · {property.baths} ba · {property.sqft.toLocaleString()} sf</span>
              </div>
            </div>
          </article>
        ))}
      </div>

      {filteredProperties.length === 0 && (
        <div className="mf-empty">
          <SearchIcon />
          <h3>No residences found</h3>
          <p>Try adjusting your search criteria or filters.</p>
          <button className="mf-btn mf-btn--solid" onClick={clearFilters}>Clear filters</button>
        </div>
      )}
    </div>
  );
};

export default Search;
