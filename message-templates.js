/**
 * message-templates.js
 *
 * 10 WhatsApp outreach variations + 5 follow-up variations.
 * All use the same tokens: {{business_name}} {{rating}} {{review_count}}
 * {{demo_url}} {{category}} {{city}}
 *
 * Usage:
 *   const { getWaTemplate, getFuTemplate } = require('./message-templates');
 *   const { text, version } = getWaTemplate(lead);  // random, no consecutive repeats
 */

'use strict';

// ─── Token filler ─────────────────────────────────────────────────────────────
function fill(template, lead) {
  return template
    .replace(/{{business_name}}/g, lead.name      || 'your business')
    .replace(/{{rating}}/g,        lead.rating    || 'highly rated')
    .replace(/{{review_count}}/g,  lead.reviews   || 'many')
    .replace(/{{demo_url}}/g,      lead.demo_url  || '')
    .replace(/{{category}}/g,      lead.category  || 'your services')
    .replace(/{{city}}/g,          lead.city      || 'your area');
}

// ─── WhatsApp outreach — 10 variations ───────────────────────────────────────
const WA_TEMPLATES = [

  // v1 — Direct (original)
  `Hey! I just built {{business_name}} a free website — {{rating}} stars and {{review_count}} reviews but no site? You're losing customers every day to competitors with worse service but a better online presence.

Here's what I built for you: {{demo_url}}

It's live right now. Mobile-friendly, your number front and center, ready to launch. Reply if you want to keep it.

— Vincent`,

  // v2 — Curiosity hook
  `Quick question — did you know {{business_name}} doesn't come up when people search for {{category}} in {{city}}?

I fixed that. Here's your free site: {{demo_url}}

{{rating}} stars and {{review_count}} reviews — you deserve to be found online. Reply and I'll get it live under your domain.

— Vincent`,

  // v3 — Compliment first
  `{{rating}} stars and {{review_count}} reviews — {{business_name}} is clearly doing something right.

I built you a website to match that reputation: {{demo_url}}

Free to look at, easy to keep. Just reply if you want it. — Vincent`,

  // v4 — Pain point
  `Every day without a website is a customer choosing your competitor instead of you.

I built {{business_name}} a free site: {{demo_url}}

{{rating}} stars — you deserve to be found. No catch, no commitment. — Vincent`,

  // v5 — Local angle
  `Hey, I was looking for {{category}} in {{city}} and {{business_name}} came up with {{rating}} stars — impressive.

Only thing missing was a website so I built one: {{demo_url}}

Take a look. Reply if you want to keep it. — Vincent`,

  // v6 — Urgent
  `{{business_name}} — I built you a website and it's already live: {{demo_url}}

Your competitors are getting customers from Google right now. You're not — because you don't have a site.

{{rating}} stars and {{review_count}} reviews means people love you. Let them find you. Reply to claim it.

— Vincent`,

  // v7 — Story-based
  `I was searching for {{category}} in {{city}} last week. Couldn't find {{business_name}} online anywhere.

Then I looked you up — {{rating}} stars, {{review_count}} reviews. You're clearly the best option. People just can't find you.

So I built you a site: {{demo_url}}

Reply if you want it. It's yours. — Vincent`,

  // v8 — Question-led
  `How many customers are you losing to businesses with half your ratings?

{{business_name}} has {{rating}} stars and {{review_count}} reviews — that's better than most in {{city}}.

But when people search {{category}} online, they can't find you.

I fixed it: {{demo_url}} — Reply to keep it. — Vincent`,

  // v9 — Social proof focused
  `{{review_count}} people gave {{business_name}} {{rating}} stars. That's real trust, earned the hard way.

The only thing between you and more customers is a website. So I built one: {{demo_url}}

It's live, it's free to look at, and it has your number front and center. — Vincent`,

  // v10 — Results focused
  `Businesses in {{city}} with a website get 4x more calls than those without.

{{business_name}} has {{rating}} stars — you'd crush it online. So I built you a site: {{demo_url}}

No cost, no contract. Just reply "yes" and I'll get it live under your own domain this week.

— Vincent`,
];

// ─── Follow-up — 5 variations ────────────────────────────────────────────────
const FU_TEMPLATES = [

  // fu-1 — Gentle reminder
  `Hey, just wanted to make sure you saw this — I built {{business_name}} a free website last week: {{demo_url}}

Still free to look at, just reply if you want to keep it. — Vincent`,

  // fu-2 — Scarcity
  `Hey — checking back on the free site I built for {{business_name}}: {{demo_url}}

I can only hold it a few more days before I offer it to another {{category}} in {{city}}. Just reply and it's yours.

— Vincent`,

  // fu-3 — Reframe value
  `Still thinking about it? No pressure at all.

Just wanted to remind you — {{business_name}} has {{rating}} stars and {{review_count}} reviews. A website makes sure people actually find you before going to a competitor.

The site's still live: {{demo_url}} — Vincent`,

  // fu-4 — Super short
  `Hey! Did you get a chance to check out the site I built for you? {{demo_url}}

Still free. Just reply yes. — Vincent`,

  // fu-5 — New angle
  `Following up on the free website I built for {{business_name}}.

One thing I didn't mention — it's mobile-first, so every customer searching on their phone will see you. Most of your competitors' sites aren't.

Still yours free: {{demo_url}} — Vincent`,
];

// ─── Selector with no-consecutive-repeat ─────────────────────────────────────
let lastWaVersion  = -1;
let lastFuVersion  = -1;

function pickRandom(arr, lastIdx) {
  if (arr.length === 1) return 0;
  let idx;
  do { idx = Math.floor(Math.random() * arr.length); } while (idx === lastIdx);
  return idx;
}

/**
 * Returns { text, version } for a WhatsApp outreach message.
 * `version` is "v1"–"v10" and stored in leads.csv message_version.
 */
function getWaTemplate(lead) {
  const idx     = pickRandom(WA_TEMPLATES, lastWaVersion);
  lastWaVersion = idx;
  return { text: fill(WA_TEMPLATES[idx], lead), version: `v${idx + 1}` };
}

/**
 * Returns { text, version } for a follow-up message.
 */
function getFuTemplate(lead) {
  const idx     = pickRandom(FU_TEMPLATES, lastFuVersion);
  lastFuVersion = idx;
  return { text: fill(FU_TEMPLATES[idx], lead), version: `fu${idx + 1}` };
}

module.exports = { getWaTemplate, getFuTemplate, WA_TEMPLATES, FU_TEMPLATES };
