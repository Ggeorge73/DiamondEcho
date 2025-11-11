// Mock data for DiamondEcho Realty

export const properties = [
  {
    id: 1,
    title: "Stunning Modern Mansion with Pool",
    address: "1245 Ocean Drive",
    city: "Miami Beach",
    state: "FL",
    zip: "33139",
    price: 4500000,
    beds: 6,
    baths: 5.5,
    sqft: 6800,
    propertyType: "Single Family",
    status: "For Sale",
    images: [
      "https://images.unsplash.com/photo-1505843513577-22bb7d21e455",
      "https://images.unsplash.com/photo-1416331108676-a22ccb276e35",
      "https://images.unsplash.com/photo-1679939153983-07827f66e672"
    ],
    description: "Breathtaking luxury mansion featuring stunning ocean views, infinity pool, state-of-the-art kitchen, and expansive outdoor living spaces. Perfect for entertaining.",
    yearBuilt: 2020,
    lotSize: 15000,
    features: ["Pool", "Ocean View", "Smart Home", "Gourmet Kitchen", "Home Theater", "Wine Cellar"],
    schoolRating: 9,
    walkScore: 85,
    taxHistory: [{ year: 2024, amount: 45000 }, { year: 2023, amount: 43000 }],
    priceHistory: [{ date: "2024-01-15", price: 4500000, event: "Listed" }],
    lat: 25.7907,
    lng: -80.130
  },
  {
    id: 2,
    title: "Elegant Mediterranean Villa",
    address: "789 Sunset Boulevard",
    city: "Los Angeles",
    state: "CA",
    zip: "90069",
    price: 6200000,
    beds: 7,
    baths: 6,
    sqft: 8500,
    propertyType: "Single Family",
    status: "For Sale",
    images: [
      "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9",
      "https://images.unsplash.com/photo-1649769425787-bb8f1119b072",
      "https://images.unsplash.com/photo-1601002257790-ebe0966a85ae"
    ],
    description: "Timeless Mediterranean estate with soaring ceilings, imported Italian marble, resort-style backyard with pool and spa, and breathtaking city views.",
    yearBuilt: 2018,
    lotSize: 22000,
    features: ["Pool", "City Views", "Guest House", "3-Car Garage", "Wine Cellar", "Outdoor Kitchen"],
    schoolRating: 10,
    walkScore: 78,
    taxHistory: [{ year: 2024, amount: 62000 }, { year: 2023, amount: 60000 }],
    priceHistory: [{ date: "2024-02-20", price: 6200000, event: "Listed" }],
    lat: 34.0901,
    lng: -118.3814
  },
  {
    id: 3,
    title: "Luxurious Waterfront Estate",
    address: "456 Lakeshore Drive",
    city: "Chicago",
    state: "IL",
    zip: "60611",
    price: 3800000,
    beds: 5,
    baths: 4.5,
    sqft: 5600,
    propertyType: "Single Family",
    status: "For Sale",
    images: [
      "https://images.unsplash.com/photo-1574120582683-1adf79c5dfd5",
      "https://images.unsplash.com/photo-1762568702039-9ef749e06152",
      "https://images.pexels.com/photos/8082312/pexels-photo-8082312.jpeg"
    ],
    description: "Rare waterfront opportunity with private dock, panoramic lake views, floor-to-ceiling windows, and luxurious finishes throughout.",
    yearBuilt: 2019,
    lotSize: 18000,
    features: ["Waterfront", "Private Dock", "Lake Views", "Fireplace", "Hardwood Floors", "Chef's Kitchen"],
    schoolRating: 8,
    walkScore: 92,
    taxHistory: [{ year: 2024, amount: 38000 }, { year: 2023, amount: 37000 }],
    priceHistory: [{ date: "2024-03-10", price: 3800000, event: "Listed" }],
    lat: 41.8902,
    lng: -87.6134
  },
  {
    id: 4,
    title: "Contemporary Urban Penthouse",
    address: "2100 Park Avenue",
    city: "New York",
    state: "NY",
    zip: "10029",
    price: 5500000,
    beds: 4,
    baths: 3.5,
    sqft: 4200,
    propertyType: "Condo",
    status: "For Sale",
    images: [
      "https://images.unsplash.com/photo-1740484408615-0beef22972dd",
      "https://images.unsplash.com/photo-1512915922686-57c11dde9b6b",
      "https://images.unsplash.com/photo-1679939153983-07827f66e672"
    ],
    description: "Ultra-luxury penthouse with wraparound terrace, skyline views, premium appliances, and access to world-class amenities including gym, spa, and concierge.",
    yearBuilt: 2021,
    lotSize: null,
    features: ["Skyline Views", "Terrace", "Doorman", "Gym", "Spa", "Parking"],
    schoolRating: 9,
    walkScore: 98,
    taxHistory: [{ year: 2024, amount: 55000 }, { year: 2023, amount: 53000 }],
    priceHistory: [{ date: "2024-04-05", price: 5500000, event: "Listed" }],
    lat: 40.7943,
    lng: -73.9526
  },
  {
    id: 5,
    title: "Classic Colonial Estate",
    address: "890 Heritage Lane",
    city: "Boston",
    state: "MA",
    zip: "02116",
    price: 2900000,
    beds: 5,
    baths: 4,
    sqft: 5200,
    propertyType: "Single Family",
    status: "For Sale",
    images: [
      "https://images.unsplash.com/photo-1758551472051-168a35343bef",
      "https://images.pexels.com/photos/740587/pexels-photo-740587.jpeg",
      "https://images.unsplash.com/photo-1601002257790-ebe0966a85ae"
    ],
    description: "Timeless colonial charm meets modern luxury. Featuring original hardwood floors, updated gourmet kitchen, master suite with spa bath, and private backyard oasis.",
    yearBuilt: 1985,
    lotSize: 12000,
    features: ["Hardwood Floors", "Updated Kitchen", "Master Suite", "Garden", "2-Car Garage", "Basement"],
    schoolRating: 10,
    walkScore: 88,
    taxHistory: [{ year: 2024, amount: 29000 }, { year: 2023, amount: 28000 }],
    priceHistory: [{ date: "2024-01-25", price: 2900000, event: "Listed" }],
    lat: 42.3505,
    lng: -71.0767
  },
  {
    id: 6,
    title: "Modern Architectural Masterpiece",
    address: "567 Design Way",
    city: "Austin",
    state: "TX",
    zip: "78701",
    price: 3200000,
    beds: 4,
    baths: 3.5,
    sqft: 4800,
    propertyType: "Single Family",
    status: "For Sale",
    images: [
      "https://images.unsplash.com/photo-1505843795480-5cfb3c03f6ff",
      "https://images.unsplash.com/photo-1416331108676-a22ccb276e35",
      "https://images.unsplash.com/photo-1649769425787-bb8f1119b072"
    ],
    description: "Award-winning contemporary design with clean lines, abundant natural light, chef's kitchen, and seamless indoor-outdoor living spaces.",
    yearBuilt: 2022,
    lotSize: 10000,
    features: ["Modern Design", "Open Floor Plan", "Smart Home", "Pool", "Solar Panels", "EV Charging"],
    schoolRating: 9,
    walkScore: 82,
    taxHistory: [{ year: 2024, amount: 32000 }, { year: 2023, amount: 30000 }],
    priceHistory: [{ date: "2024-05-12", price: 3200000, event: "Listed" }],
    lat: 30.2711,
    lng: -97.7437
  },
  {
    id: 7,
    title: "Beachfront Paradise Villa",
    address: "123 Coastal Highway",
    city: "Malibu",
    state: "CA",
    zip: "90265",
    price: 8900000,
    beds: 6,
    baths: 7,
    sqft: 7200,
    propertyType: "Single Family",
    status: "For Sale",
    images: [
      "https://images.unsplash.com/photo-1574120582683-1adf79c5dfd5",
      "https://images.unsplash.com/photo-1505843513577-22bb7d21e455",
      "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9"
    ],
    description: "Direct beach access, panoramic ocean views from every room, infinity pool, private elevator, wine cellar, and home theater. Pure luxury living.",
    yearBuilt: 2021,
    lotSize: 8500,
    features: ["Beach Access", "Ocean Views", "Pool", "Elevator", "Wine Cellar", "Theater Room"],
    schoolRating: 8,
    walkScore: 65,
    taxHistory: [{ year: 2024, amount: 89000 }, { year: 2023, amount: 85000 }],
    priceHistory: [{ date: "2024-06-01", price: 8900000, event: "Listed" }],
    lat: 34.0259,
    lng: -118.7798
  },
  {
    id: 8,
    title: "Sophisticated Downtown Loft",
    address: "789 Market Street",
    city: "San Francisco",
    state: "CA",
    zip: "94102",
    price: 2100000,
    beds: 2,
    baths: 2,
    sqft: 2400,
    propertyType: "Condo",
    status: "For Sale",
    images: [
      "https://images.unsplash.com/photo-1601002257790-ebe0966a85ae",
      "https://images.unsplash.com/photo-1679939153983-07827f66e672",
      "https://images.unsplash.com/photo-1740484408615-0beef22972dd"
    ],
    description: "Converted warehouse loft with exposed brick, soaring ceilings, industrial-chic design, and premium finishes. Walk to everything downtown has to offer.",
    yearBuilt: 2017,
    lotSize: null,
    features: ["Exposed Brick", "High Ceilings", "Hardwood Floors", "Updated Kitchen", "In-Unit Laundry", "Parking"],
    schoolRating: 7,
    walkScore: 99,
    taxHistory: [{ year: 2024, amount: 21000 }, { year: 2023, amount: 20000 }],
    priceHistory: [{ date: "2024-03-18", price: 2100000, event: "Listed" }],
    lat: 37.7833,
    lng: -122.4167
  }
];

export const featuredProperties = properties.slice(0, 4);

export const neighborhoods = [
  {
    name: "Miami Beach",
    city: "Miami Beach, FL",
    avgPrice: 1200000,
    properties: 45,
    image: "https://images.unsplash.com/photo-1505843513577-22bb7d21e455"
  },
  {
    name: "Beverly Hills",
    city: "Los Angeles, CA",
    avgPrice: 3500000,
    properties: 32,
    image: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9"
  },
  {
    name: "Back Bay",
    city: "Boston, MA",
    avgPrice: 2100000,
    properties: 28,
    image: "https://images.unsplash.com/photo-1758551472051-168a35343bef"
  },
  {
    name: "Upper East Side",
    city: "New York, NY",
    avgPrice: 2800000,
    properties: 67,
    image: "https://images.unsplash.com/photo-1740484408615-0beef22972dd"
  }
];

export const agents = [
  {
    id: 1,
    name: "Sarah Mitchell",
    title: "Senior Luxury Specialist",
    phone: "(305) 555-0123",
    email: "sarah.mitchell@diamondecho.com",
    photo: "https://i.pravatar.cc/300?img=1",
    bio: "15+ years experience in luxury real estate",
    listings: 23
  },
  {
    id: 2,
    name: "Michael Chen",
    title: "Investment Property Expert",
    phone: "(310) 555-0456",
    email: "michael.chen@diamondecho.com",
    photo: "https://i.pravatar.cc/300?img=33",
    bio: "Specializing in fix & flip opportunities",
    listings: 18
  },
  {
    id: 3,
    name: "Emily Rodriguez",
    title: "Waterfront Specialist",
    phone: "(312) 555-0789",
    email: "emily.rodriguez@diamondecho.com",
    photo: "https://i.pravatar.cc/300?img=5",
    bio: "Expert in coastal and waterfront properties",
    listings: 31
  }
];

export const testimonials = [
  {
    id: 1,
    name: "Jennifer Thompson",
    role: "Home Buyer",
    content: "DiamondEcho Realty made our home buying experience seamless. Their attention to detail and market knowledge is unmatched.",
    rating: 5
  },
  {
    id: 2,
    name: "David Martinez",
    role: "Real Estate Investor",
    content: "The Fix & Flip analysis tool helped me identify profitable deals quickly. I've completed 5 successful flips using their platform.",
    rating: 5
  },
  {
    id: 3,
    name: "Amanda Foster",
    role: "Home Seller",
    content: "Our home sold in 10 days above asking price. The DiamondEcho team is professional, responsive, and results-driven.",
    rating: 5
  }
];