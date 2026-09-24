// A listing link is durable across reloads; manual Deal Studio entry has no listing ID.
export const resolveListingContext = (search, listings) => {
  const params = new URLSearchParams(search);
  if (!params.has('listing')) return { kind: 'manual' };

  const id = params.get('listing');
  const listing = listings.find((item) => String(item.id) === id);
  return listing ? { kind: 'listing', listing } : { kind: 'missing', id };
};

export const recordFromListing = (listing) => ({
  source_listing_id: listing.id,
  formatted_address: [listing.address, listing.city, [listing.state, listing.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
  city: listing.city,
  state: listing.state,
  property_type: listing.propertyType,
  square_footage: listing.sqft,
  price: listing.price,
  annual_taxes: listing.taxHistory?.[0]?.amount,
  bedrooms: listing.beds,
  bathrooms: listing.baths,
  year_built: listing.yearBuilt,
  provider: 'DiamondEcho listing',
  is_demo: true,
});
