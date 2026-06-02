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
  locksmith:        '#607D8B',
  'auto repair':    '#FF5722',
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
  const phoneRaw = (business.phone || '').replace(/\D/g, '');
  const color = COLORS[category.toLowerCase()] || '#2563eb';

  const html = template
    .replace(/{{business_name}}/g, business.name || 'Local Business')
    .replace(/{{category}}/g, category)
    .replace(/{{category_title}}/g, titleCase(category))
    .replace(/{{city}}/g, business.city || 'Miami')
    .replace(/{{phone}}/g, business.phone || '')
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
