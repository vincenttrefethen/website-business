const fs = require('fs');
const path = require('path');
const config = require('./config');

const SERVICE_CARDS = {
  plumber: [
    { icon: '🚿', title: 'Leak Repair', desc: 'Pipes, faucets, and fixtures fixed fast' },
    { icon: '🚽', title: 'Drain Cleaning', desc: 'Clogged drains cleared same day' },
    { icon: '🔧', title: 'Water Heater', desc: 'Installation and repair' },
    { icon: '🏠', title: 'Remodels', desc: 'Bathroom and kitchen plumbing' },
  ],
  electrician: [
    { icon: '💡', title: 'Panel Upgrades', desc: 'Breaker boxes and service upgrades' },
    { icon: '🔌', title: 'Outlets & Wiring', desc: 'New outlets and rewiring' },
    { icon: '🏠', title: 'Lighting', desc: 'Indoor and outdoor installation' },
    { icon: '⚡', title: 'Emergency Service', desc: '24/7 electrical repairs' },
  ],
  'cleaning service': [
    { icon: '🧹', title: 'Deep Cleaning', desc: 'Top-to-bottom home cleaning' },
    { icon: '🏢', title: 'Commercial', desc: 'Offices and commercial spaces' },
    { icon: '🛁', title: 'Move In/Out', desc: 'Full move-in and move-out cleans' },
    { icon: '📅', title: 'Weekly Service', desc: 'Recurring scheduled cleanings' },
  ],
  landscaping: [
    { icon: '✂️', title: 'Lawn Mowing', desc: 'Weekly and bi-weekly cuts' },
    { icon: '🌿', title: 'Trimming', desc: 'Hedges, shrubs, and trees' },
    { icon: '🌱', title: 'Sod & Planting', desc: 'New grass and garden installs' },
    { icon: '💧', title: 'Irrigation', desc: 'Sprinkler system service' },
  ],
  painter: [
    { icon: '🖌️', title: 'Interior Paint', desc: 'Walls, ceilings, trim, and more' },
    { icon: '🏠', title: 'Exterior Paint', desc: 'Curb appeal transformations' },
    { icon: '🏢', title: 'Commercial', desc: 'Offices and retail spaces' },
    { icon: '🎨', title: 'Color Matching', desc: 'Expert color consultation' },
  ],
  handyman: [
    { icon: '🔨', title: 'Repairs', desc: 'Drywall, doors, and fixtures' },
    { icon: '🪑', title: 'Assembly', desc: 'Furniture and equipment assembly' },
    { icon: '🪟', title: 'Installation', desc: 'TV mounts, shelves, blinds' },
    { icon: '🔧', title: 'Maintenance', desc: 'Honey-do lists handled' },
  ],
  'pest control': [
    { icon: '🐜', title: 'Ant & Roach', desc: 'Indoor and outdoor treatments' },
    { icon: '🦟', title: 'Mosquito Control', desc: 'Yard spray programs' },
    { icon: '🐀', title: 'Rodents', desc: 'Trapping and exclusion' },
    { icon: '🏠', title: 'Preventive Plans', desc: 'Monthly protection programs' },
  ],
  'ac repair': [
    { icon: '❄️', title: 'AC Repair', desc: 'All makes and models serviced' },
    { icon: '🔧', title: 'Maintenance', desc: 'Tune-ups and filter changes' },
    { icon: '🏠', title: 'Installation', desc: 'New unit installation' },
    { icon: '⚡', title: 'Emergency', desc: '24/7 emergency AC service' },
  ],
  locksmith: [
    { icon: '🔑', title: 'Lockout Service', desc: 'Home, car, and office lockouts' },
    { icon: '🔒', title: 'Lock Rekey', desc: 'Rekeying and replacement' },
    { icon: '🚗', title: 'Auto Locks', desc: 'Car keys and ignition' },
    { icon: '🏠', title: 'Security Locks', desc: 'Deadbolts and smart locks' },
  ],
  'auto repair': [
    { icon: '🔧', title: 'Engine Repair', desc: 'Diagnostics and full repairs' },
    { icon: '🛞', title: 'Brakes & Tires', desc: 'Brake pads, rotors, tires' },
    { icon: '🛢️', title: 'Oil Change', desc: 'Quick lube and fluid service' },
    { icon: '⚡', title: 'Electrical', desc: 'Battery and electrical system' },
  ],
  'mobile detailing': [
    { icon: '🚗', title: 'Full Detail', desc: 'Interior and exterior top-to-bottom' },
    { icon: '✨', title: 'Express Wash', desc: 'Quick clean at your location' },
    { icon: '🪟', title: 'Paint Correction', desc: 'Swirl removal and polish' },
    { icon: '🛡️', title: 'Ceramic Coating', desc: 'Long-lasting paint protection' },
  ],
  'house painter': [
    { icon: '🖌️', title: 'Interior Paint', desc: 'Walls, ceilings, trim, and doors' },
    { icon: '🏠', title: 'Exterior Paint', desc: 'Full exterior and pressure wash prep' },
    { icon: '🎨', title: 'Color Consult', desc: 'Help picking the perfect palette' },
    { icon: '🪣', title: 'Cabinet Painting', desc: 'Kitchen and bathroom refresh' },
  ],
  'pressure washing': [
    { icon: '💦', title: 'Driveways', desc: 'Oil stains and grime blasted clean' },
    { icon: '🏠', title: 'House Wash', desc: 'Roof, siding, and gutters' },
    { icon: '🪵', title: 'Decks & Fences', desc: 'Restore wood and composite' },
    { icon: '🏢', title: 'Commercial', desc: 'Parking lots and storefronts' },
  ],
  'mobile notary': [
    { icon: '📝', title: 'Document Signing', desc: 'We come to you — home or office' },
    { icon: '🏠', title: 'Real Estate', desc: 'Closings and loan signings' },
    { icon: '⚖️', title: 'Legal Docs', desc: 'Wills, trusts, and affidavits' },
    { icon: '🚗', title: 'Mobile Service', desc: 'Available 7 days including evenings' },
  ],
  'personal trainer': [
    { icon: '💪', title: '1-on-1 Training', desc: 'Custom workouts built for your goals' },
    { icon: '🏠', title: 'In-Home Sessions', desc: 'Train in your own space' },
    { icon: '🥗', title: 'Nutrition Coaching', desc: 'Meal plans and accountability' },
    { icon: '📱', title: 'Online Training', desc: 'Remote coaching and programming' },
  ],
  'dog groomer': [
    { icon: '🐶', title: 'Full Groom', desc: 'Bath, cut, brush, and nails' },
    { icon: '🛁', title: 'Bath & Brush', desc: 'Blowout and de-shed treatment' },
    { icon: '✂️', title: 'Breed Cuts', desc: 'Breed-standard styling' },
    { icon: '🚐', title: 'Mobile Grooming', desc: 'We come to your driveway' },
  ],
  photography: [
    { icon: '📸', title: 'Portraits', desc: 'Family, headshots, and graduation' },
    { icon: '💒', title: 'Weddings', desc: 'Full day coverage and albums' },
    { icon: '🏠', title: 'Real Estate', desc: 'Listings that sell faster' },
    { icon: '📦', title: 'Product & Brand', desc: 'E-commerce and social content' },
  ],
  'food truck': [
    { icon: '🍽️', title: 'Daily Service', desc: 'Find us on the schedule below' },
    { icon: '🎉', title: 'Private Events', desc: 'Weddings, parties, and corporate' },
    { icon: '🏢', title: 'Office Catering', desc: 'Lunch service for your team' },
    { icon: '📍', title: 'Find Us', desc: 'Follow for daily location updates' },
  ],
};

const COLORS = {
  plumber:          '#2196F3',
  electrician:      '#FF9800',
  'cleaning service': '#4CAF50',
  landscaping:      '#66BB6A',
  painter:          '#E91E63',
  handyman:         '#795548',
  'pest control':   '#F44336',
  'ac repair':      '#00BCD4',
  locksmith:           '#607D8B',
  'auto repair':       '#FF5722',
  'mobile detailing':  '#1565C0',
  'house painter':     '#AD1457',
  'pressure washing':  '#0288D1',
  'mobile notary':     '#4527A0',
  'personal trainer':  '#2E7D32',
  'dog groomer':       '#F57F17',
  photography:         '#37474F',
  'food truck':        '#E65100',
};

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function titleCase(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

function buildServiceCards(category) {
  const cards = SERVICE_CARDS[category.toLowerCase()] || [
    { icon: '⭐', title: 'Quality Service', desc: 'Professional and reliable' },
    { icon: '📞', title: 'Fast Response', desc: 'We pick up the phone' },
    { icon: '💯', title: 'Satisfaction', desc: 'Guaranteed every time' },
    { icon: '📍', title: 'Local', desc: 'Your neighbors in the community' },
  ];
  return cards.map(c => `
    <div class="service-card reveal">
      <div class="sc-icon">${c.icon}</div>
      <div class="sc-title">${c.title}</div>
      <div class="sc-desc">${c.desc}</div>
      <div class="sc-arrow">→</div>
    </div>`).join('');
}

function generateSite(business) {
  const template = fs.readFileSync(config.SITE_TEMPLATE, 'utf8');
  const category = business.category || 'service';
  const phone = business.phone || '(305) 555-0100';
  const phoneRaw = phone.replace(/\D/g, '');
  const color = COLORS[category.toLowerCase()] || '#2563eb';

  const html = template
    .replace(/{{business_name}}/g, business.name || 'Local Business')
    .replace(/{{category}}/g, category)
    .replace(/{{category_title}}/g, titleCase(category))
    .replace(/{{city}}/g, business.city || 'Miami')
    .replace(/{{phone}}/g, phone)
    .replace(/{{phone_raw}}/g, phoneRaw)
    .replace(/{{address}}/g, business.address || '')
    .replace(/{{primary_color}}/g, color)
    .replace(/{{year}}/g, new Date().getFullYear())
    .replace(/{{service_cards}}/g, buildServiceCards(category));

  const slug = slugify(business.name || 'business');
  const siteDir = path.join(config.SITES_FOLDER, slug);
  fs.mkdirSync(siteDir, { recursive: true });

  const outPath = path.join(siteDir, 'index.html');
  fs.writeFileSync(outPath, html, 'utf8');

  return { slug, outPath };
}

module.exports = { generateSite, slugify };
