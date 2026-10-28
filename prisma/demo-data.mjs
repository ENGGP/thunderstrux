// Rich demo data for the local dev database, on top of prisma/seed.mjs ([[Seeding and Data]]).
// Everything it writes hangs off a `demo-` society owned by an `@demo.example.com` account, or is a
// `@demo.example.com` account or guest. A re-run deletes those societies with all their rows and
// rebuilds them with dates relative to today; base seed rows and hand-made data are never touched.
// Purchases are fake rows in the shapes checkout, fulfilment, refunds and disputes write: nothing
// here calls Stripe.
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { createJiti } from "jiti";
import sharp from "sharp";

// Dev only, with no override: the preview's database has the same name, so NODE_ENV and the
// app's origin are what tell them apart.
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const appUrls = ["AUTH_URL", "NEXTAUTH_URL", "NEXT_PUBLIC_APP_URL"].map((name) => process.env[name]).filter(Boolean);
const databaseName = URL.canParse(process.env.DATABASE_URL ?? "") ? new URL(process.env.DATABASE_URL).pathname.slice(1) : "";
if (
  process.env.NODE_ENV !== "development" ||
  appUrls.length === 0 ||
  appUrls.some((url) => !URL.canParse(url) || !loopbackHosts.has(new URL(url).hostname)) ||
  !databaseName ||
  databaseName.endsWith("_test")
) {
  console.error("Refusing to load demo data: it is only for the local dev database (NODE_ENV=development, loopback app URLs, a database not named *_test).");
  process.exit(1);
}

// One quiet client for this script and the app services it calls (lib/db logs every query in development).
const prisma = (globalThis.prisma = new PrismaClient());
const jiti = createJiti(import.meta.url, { alias: { "@/": `${process.cwd()}/` } });
const { uploadAsset } = await jiti.import("../lib/assets/service.ts");
const { assetStorage } = await jiti.import("../lib/assets/storage.ts");
const { updateProfile } = await jiti.import("../lib/organisations/profile.ts");
const { beginStaffMfaEnrollment, confirmStaffMfaEnrollment, totpCode } = await jiti.import("../lib/security/staff-mfa.ts");
const { calculatePlatformFee, PLATFORM_FEE_POLICY_VERSION } = await jiti.import("../lib/stripe/fees.ts");
const { PURCHASE_SNAPSHOT_VERSION } = await jiti.import("../lib/purchases/projection.ts");

// A fixed seed, so every load has the same shape; dates follow today.
let seed = 20261029;
function random() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (list) => list[Math.floor(random() * list.length)];
const chance = (p) => random() < p;
const weighted = (entries) => {
  let roll = random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  return (entries.find(([, weight]) => (roll -= weight) < 0) ?? entries[0])[0];
};
const shuffle = (list) => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const now = new Date();
const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const ago = (ms) => new Date(now.getTime() - ms);
const later = (date, ms) => new Date(date.getTime() + ms);
const between = (from, to) => new Date(from.getTime() + random() * Math.max(0, to.getTime() - from.getTime()));
// A later step (a refund, a dispute), within `maxDays` and never in the future.
const after = (from, maxDays = 20) => {
  const end = Math.min(now.getTime() - minute, from.getTime() + maxDays * day);
  return between(new Date(Math.min(from.getTime() + hour, end)), new Date(end));
};
// A Brisbane wall-clock time `days` from today (UTC+10, no daylight saving).
const brisbane = (days, hours = 18) => {
  const date = new Date(now.getTime() + days * day);
  date.setUTCHours(hours - 10, 0, 0, 0);
  return date;
};
const year = now.getUTCFullYear();
const newYear = (y) => new Date(Date.UTC(y, 0, 1) - 10 * hour);
const fullName = (person) => [person.firstName, person.lastName].filter(Boolean).join(" ") || null;

const firstNames = ["Ava", "Liam", "Mia", "Noah", "Isla", "Leo", "Zara", "Ethan", "Chloe", "Lucas", "Ruby", "Oliver", "Grace", "Jack", "Sienna", "Mason", "Harper", "Kai", "Ivy", "Hugo", "Matilda", "Aarav", "Priya", "Wei", "Mei", "Hiroshi", "Yuki", "Fatima", "Omar", "Amara", "Kofi", "Sofia", "Mateo", "Lucia", "Diego", "Elena", "Nikolai", "Anya", "Tane", "Aroha", "Finn", "Saoirse", "Rhys", "Bronte", "Jasper", "Willow", "Arjun", "Ananya", "Minh", "Linh", "Jae", "Seoyeon", "Lachlan", "Tahlia", "Kalani", "Mahala", "Rafael", "Ines", "Theo", "Nina"];
const lastNames = ["Nguyen", "Smith", "Patel", "Chen", "Williams", "Kim", "Brown", "Singh", "Jones", "Wang", "Taylor", "Tanaka", "Martin", "Garcia", "Okafor", "Wilson", "Rossi", "Kaur", "Anderson", "Murphy", "Haddad", "Lee", "Thompson", "Ali", "Walker", "Moreau", "Ivanova", "Clarke", "Mensah", "Ng"];
const guestNames = [["Sam", "Rivers"], ["Alex", "Moana"], ["Jordan", "Blake"], ["Robin", "Hart"], ["Charlie", "Dunn"], ["Quinn", "Ashby"], ["Riley", "Fox"], ["Skyler", "Penn"], ["Morgan", "Vale"], ["Jamie", "Cruz"]];

const ticketText = "Doors open 30 minutes before the start. Bring your ticket on your phone; staff scan it at the door.";
const societies = [
  {
    key: "film", name: "Film Society", age: 420, stripe: "READY", mfa: true, colours: ["#14213d", "#fca311"], logo: true, cover: true,
    profile: {
      description: "Screenings, festivals and filmmaking workshops for anyone who loves cinema. Members get cheaper tickets, previews and first pick of festival seats.",
      refundPolicy: "Refunds up to 48 hours before a screening. If we cancel an event, every ticket is refunded in full automatically.",
      pickupPolicy: "Collect merchandise from the Film Society desk, Student Hub level 2, Tuesdays and Thursdays 12-2pm. Bring your order number."
    },
    staff: [[0, "admin"], [1, "event_manager"], [2, "finance_manager"], [3, "check_in_staff"], ["event.manager@example.com", "check_in_staff"], [4, "event_manager", "revoked"]],
    invites: [["new.projectionist@demo.example.com", "event_manager", 5], ["late.helper@demo.example.com", "check_in_staff", -3]],
    joins: 45, baseMember: true,
    plans: [
      { name: `${year} Membership`, price: 2000, term: [newYear(year), newYear(year + 1)], rights: ["member_prices", "members_only_events"], grants: 32, member: true, refunded: 1, incomplete: 4 },
      { name: `${year - 1} Membership`, price: 1500, term: [newYear(year - 1), newYear(year)], rights: ["member_prices"], archived: true, grants: 10 },
      { name: "Summer Pass", price: 1200, term: [new Date(Date.UTC(year, 11, 1) - 10 * hour), new Date(Date.UTC(year + 1, 2, 1) - 10 * hour)], rights: ["member_prices"], draft: true }
    ],
    events: [
      { title: "Opening Night: Cinema Paradiso", days: 3, at: 19, hours: 3, place: "Union Cinema", hero: true, types: [["General admission", 1200, 120, 800], ["Concession", 900, 40, 600]], sales: 25, member: "paid", specials: ["pending"] },
      { title: "Midnight Horror Marathon", days: 6, at: 22, hours: 7, place: "Lecture Theatre A", hero: true, types: [["Single film", 800, 60], ["Full marathon", 1500, 80, 1000], ["Marathon + snack pack", 2200, 30, 1700], ["VIP couch (fits two)", 3500, 4]], sales: 18, fill: ["VIP couch (fits two)"], member: "refunded" },
      { title: "Studio Ghibli Picnic Screening", days: 9, at: 17, hours: 3, place: "Great Court lawn", hero: true, types: [["Free entry", 0, 200]], sales: 25, member: "paid", specials: ["cancelled", "released"] },
      { title: "Members' Preview: Dune Part Three", days: 11, place: "Union Cinema", visibility: "members_only", types: [["Member seat", 500, 60, 0]], sales: 10 },
      { title: "Short Film Festival Finals", days: 14, hours: 4, place: "Schonell Theatre", hero: true, types: [["General admission", 1500, 150, 1100], ["Concession", 1000, 50, 800], ["Filmmaker pass", 0, 20], ["Judges' table", 4000, 8]], sales: 22, specials: ["dispute_open", "refund_processing", "outside_refund", "pending"] },
      { title: "Silent Film with Live Orchestra", days: 16, at: 19, place: "Old Museum Concert Hall", hero: true, cancelled: { daysAgo: 2, reason: "The orchestra's venue booking fell through, so we have cancelled. Every paid ticket has been refunded in full." }, types: [["Standard", 1800, 100, 1400], ["Student rush", 0, 20]], sales: 14, member: "paid" },
      { title: "Screenwriting Workshop", days: 17, at: 10, hours: 6, place: "Forgan Smith 1-W", capacity: 25, types: [["Workshop seat", 2000, 30, 1500]], fill: true },
      { title: "Director Q&A: Local Voices", days: 20, place: "Media Lab", visibility: "unlisted", types: [["RSVP", 0, 60]], sales: 8 },
      { title: "French New Wave Night", days: 24, at: 19, place: "Union Cinema", saleState: "closed", types: [["General admission", 1000, 80, 700]], sales: 10 },
      { title: "Outdoor Cinema: Jaws by the Lake", days: 28, at: 19, place: "Lakes Lawn", hero: true, types: [["Lawn spot", 1400, 150, 1000], ["Beanbag hire", 2400, 20, 2000]], sales: 8, member: "expired" },
      { title: "Documentary Club: Free Solo", days: 33, place: "Media Lab", types: [["Free entry", 0, 40]], sales: 6, member: "cancelled" },
      { title: "Animation Showcase", days: 38, place: "Union Cinema", types: [["General admission", 1200, 100, 900]], sales: 0 },
      { title: "Oscars Watch Party", days: 45, at: 10, hours: 5, place: "Student Bar", hero: true, types: [["Brunch ticket", 2500, 60, 1800]], sales: 4, member: "pending" },
      { title: "End of Semester Film Quiz", days: 52, place: "Student Bar", status: "draft", types: [["Team of four", 2000, 20]] },
      { title: "Film Camp (planning)", days: 70, at: 9, hours: 8, place: "To be confirmed", status: "draft", types: [] },
      { title: "Kubrick Retrospective: 2001: A Space Odyssey", live: true, place: "Union Cinema", hero: true, types: [["General admission", 1000, 90, 700]], sales: 18 },
      { title: "Welcome Back Screening: Spirited Away", days: -7, place: "Union Cinema", types: [["Free entry", 0, 150]], sales: 18, member: "paid" },
      { title: "48-Hour Film Challenge Premiere", days: -21, place: "Schonell Theatre", hero: true, types: [["General admission", 1200, 120, 800], ["Concession", 900, 40, 600]], sales: 16, specials: ["dispute_won", "review"] },
      { title: "Halloween Double Feature", days: -35, at: 19, hours: 4, place: "Union Cinema", types: [["General admission", 1400, 100, 1000]], sales: 16, specials: ["dispute_lost"] },
      { title: "Cinematography Masterclass", days: -50, at: 10, hours: 5, place: "Media Lab", capacity: 20, types: [["Seat", 2500, 24, 1800]], fill: true },
      { title: "Bollywood Night", days: -70, at: 19, place: "Union Cinema", types: [["General admission", 1200, 120, 900]], sales: 14 },
      { title: "Film Society Trivia", days: -95, place: "Student Bar", types: [["Free entry", 0, 60]], sales: 12 },
      { title: "Winter Noir Season", days: -120, at: 19, place: "Union Cinema", types: [["Season pass", 3000, 40], ["Single night", 1000, 80]], sales: 12 },
      { title: "Pixar Marathon", days: -150, at: 12, hours: 9, place: "Lecture Theatre A", types: [["Marathon pass", 1500, 80]], sales: 12 },
      { title: "Semester One Launch Party", days: -190, at: 19, hours: 4, place: "Student Bar", types: [["Entry", 1000, 150]], sales: 14 },
      { title: "Annual General Meeting & Screening", days: -240, place: "Media Lab", types: [["Members and friends", 0, 80]], sales: 10 }
    ],
    products: [
      { name: "Film Society Tee", price: 2500, colours: ["Black", "Off-white"], sizes: ["S", "M", "L", "XL"], stock: 12, images: 2 },
      { name: "Canvas Tote", price: 1200, stock: 40 },
      { name: "Retro Poster Set", price: 1800, stock: 15 },
      { name: "Enamel Pin", price: 600, stock: 80 },
      { name: "Society Hoodie", price: 5500, sizes: ["S", "M", "L", "XL"], stock: 10, status: "draft" }
    ],
    merchOrders: 80
  },
  {
    key: "climbing", name: "Climbing Club", age: 300, stripe: "READY", colours: ["#264653", "#e9c46a"], cover: true,
    profile: {
      description: "Bouldering sessions, rope skills and weekend trips for climbers of every level. Shoes and harnesses available to borrow.",
      refundPolicy: "Trip deposits are refundable until the bus is booked, two weeks before departure.",
      pickupPolicy: "Pick up gear and merch at Tuesday training, Urban Climb West End, from 6pm."
    },
    staff: [[7, "event_manager"]], joins: 20, baseMember: true,
    events: [
      { title: "Intro to Bouldering", days: 5, at: 17, place: "Urban Climb West End", hero: true, types: [["Session + shoe hire", 1500, 30], ["Bring your own shoes", 1000, 20]], sales: 12 },
      { title: "Gear Swap", days: 12, at: 12, place: "Great Court", types: [["Entry", 0, 100]], sales: 10 },
      { title: "Blue Mountains Climbing Trip", days: 30, at: 7, hours: 58, place: "Katoomba (bus from campus)", hero: true, types: [["Trip place (transport + lodge)", 18500, 24], ["Deposit only", 5000, 10]], sales: 9 },
      { title: "Rope Skills Night", days: -14, place: "Urban Climb Milton", types: [["Session", 1200, 25]], sales: 12 },
      { title: "Climbing Film Night", days: -60, place: "Media Lab", types: [["Free entry", 0, 50]], sales: 12 },
      { title: "Comp Training", days: 40, place: "Urban Climb West End", status: "draft", types: [["Session", 1000, 20]] }
    ],
    products: [
      { name: "Chalk Bag", price: 2200, colours: ["Red", "Blue", "Green"], stock: 10, soldOut: ["Green"], images: 2 },
      { name: "Club Hoodie", price: 4500, sizes: ["S", "M", "L", "XL"], stock: 8 },
      { name: "Finger Tape (3 rolls)", price: 400, stock: 100 },
      { name: "Boulder Brush", price: 800, stock: 30 },
      { name: "Members' Harness Deal", price: 6500, stock: 6, status: "draft" },
      { name: "Trip Tee (last year)", price: 2000, sizes: ["M", "L"], stock: 0, status: "archived" }
    ],
    merchOrders: 30
  },
  {
    key: "debating", name: "Debating Society", age: 600, stripe: "READY", mfa: true, colours: ["#5f0f40", "#fb8b24"], logo: true,
    profile: {
      description: "Weekly debates, workshops and intervarsity competition. Members debate free and get first pick of competition places.",
      refundPolicy: "Competition fees are refundable until the draw is released."
    },
    staff: [[5, "admin"], [6, "finance_manager"]], joins: 25, baseMember: true,
    plans: [
      { name: `${year} Membership`, price: 1000, term: [newYear(year), newYear(year + 1)], rights: ["member_prices", "members_only_events"], grants: 18, revoked: 1, incomplete: 2 },
      { name: `${year + 1} Membership`, price: 1200, term: [newYear(year + 1), newYear(year + 2)], rights: ["member_prices", "members_only_events"], grants: 5, publishedDaysAgo: 14 },
      { name: `${year - 1} Membership`, price: 800, term: [newYear(year - 1), newYear(year)], rights: ["member_prices", "members_only_events"], archived: true, grants: 6, member: true }
    ],
    events: [
      { title: "Members' Debate Night", days: 4, place: "Room 7-222", visibility: "members_only", types: [["Member place", 0, 40]], sales: 12 },
      { title: "Public Debate: Should AI Write Our Laws?", days: 15, place: "Abel Smith Lecture Theatre", hero: true, types: [["General admission", 800, 200, 400]], sales: 20 },
      { title: "Intervarsity Trials", days: 22, at: 9, hours: 8, place: "Room 7-222", visibility: "members_only", types: [["Competitor", 500, 32, 0], ["Adjudicator", 0, 10]], sales: 10 },
      { title: "Debate Workshop: Rebuttals", days: -10, place: "Room 7-222", types: [["Free place", 0, 30]], sales: 14 },
      { title: "Grand Final Viewing", days: -45, at: 19, place: "Student Bar", types: [["Entry", 500, 80, 0]], sales: 15 }
    ]
  },
  {
    key: "volunteers", name: "Volunteer Collective", age: 500, stripe: "READY", colours: ["#2d6a4f", "#b7e4c7"], logo: true, cover: true,
    profile: { description: "Free volunteering for students: clean-ups, food bank shifts and community days. Sign up, turn up, help out." },
    staff: [[8, "check_in_staff"], [9, "check_in_staff"]], joins: 30,
    events: [
      { title: "Beach Clean-up at Sandgate", days: 6, at: 8, hours: 3, place: "Sandgate foreshore", hero: true, types: [["Volunteer place", 0, 50]], sales: 18, specials: ["cancelled", "released"] },
      { title: "Food Bank Shift", days: 8, at: 9, hours: 4, place: "FoodShare warehouse", capacity: 12, types: [["Volunteer shift", 0, 12]], fill: true },
      { title: "Tree Planting Day", days: 19, at: 8, hours: 5, place: "Oxley Creek Common", types: [["Volunteer place", 0, 80]], sales: 14 },
      { title: "Blood Drive Sign-up", days: 26, at: 10, hours: 6, place: "Student Hub", types: [["Donation slot", 0, 40]], sales: 8 },
      { title: "Community Garden Working Bee", days: -12, at: 9, hours: 3, place: "Campus community garden", types: [["Volunteer place", 0, 30]], sales: 16 },
      { title: "Charity Fun Run Marshals", days: -40, at: 6, hours: 4, place: "Southbank Parklands", types: [["Marshal", 0, 25]], sales: 14, specials: ["cancelled"] },
      { title: "Op Shop Sorting", days: -80, at: 10, hours: 3, place: "Vinnies Toowong", types: [["Volunteer place", 0, 20]], sales: 12 }
    ]
  },
  {
    key: "chess", name: "Chess Club", age: 200, stripe: "CONNECTED_INCOMPLETE", colours: ["#1b1b1b", "#f5f5f5"],
    profile: { partial: true, description: "Casual blitz every week, lessons for beginners and a rapid tournament each semester." },
    joins: 12,
    events: [
      { title: "Weekly Blitz", days: 2, place: "Library level 4", types: [["Board", 0, 40]], sales: 9 },
      { title: "Beginners' Lesson", days: 9, place: "Library level 4", types: [["Place", 0, 20]], sales: 6 },
      { title: "Autumn Rapid Tournament", days: 21, at: 9, hours: 8, place: "Student Hub", types: [["Entry", 1000, 48]], sales: 0 },
      { title: "Simul vs. the Club Champion", days: -20, place: "Library level 4", types: [["Board", 0, 25]], sales: 10 }
    ]
  },
  {
    key: "gaming", name: "Gaming Guild", age: 700, stripe: "ERROR", colours: ["#240046", "#ff6d00"], logo: true, cover: true,
    profile: {
      description: "Tournaments, LAN parties and retro nights. Bring a controller, or borrow one of ours.",
      refundPolicy: "Tournament entries are refundable until brackets are drawn."
    },
    staff: [[10, "finance_manager"]], joins: 15,
    events: [
      { title: "Smash Bros Tournament", days: -18, at: 12, hours: 7, place: "Student Hub", hero: true, types: [["Competitor", 1000, 64], ["Spectator", 300, 100]], sales: 26, specials: ["dispute_lost", "dispute_won", "refunded", "refunded"] },
      { title: "LAN Party", days: -75, at: 16, hours: 12, place: "Engineering Hall", types: [["Bring your own PC", 1500, 50], ["Console zone", 1000, 40]], sales: 22, specials: ["review"] },
      { title: "Retro Games Night", days: 13, at: 18, place: "Student Bar", types: [["Entry", 500, 60]], sales: 6 }
    ]
  },
  {
    key: "choir", name: "Campus Choir", age: 30, stripe: "NOT_CONNECTED", colours: ["#03045e", "#90e0ef"], joins: 8,
    events: [
      { title: "Open Rehearsal", days: 7, at: 17, place: "Music building, room 210", types: [["Free place", 0, 30]], sales: 5 },
      { title: "Winter Concert", days: 35, at: 19, place: "Mayne Hall", types: [["Free ticket", 0, 150]], sales: 8 },
      { title: "Carols Night", days: 55, at: 19, place: "Great Court", status: "draft", types: [["Free ticket", 0, 100]] }
    ]
  },
  { key: "astronomy", name: "Astronomy Society", age: 2, stripe: "NOT_CONNECTED", colours: ["#000814", "#ffc300"], joins: 0 }
];

const stripeFields = {
  READY: (key) => ({ stripeAccountId: `acct_demo_${key}`, stripeAccountStatus: "READY", stripeChargesEnabled: true, stripePayoutsEnabled: true, stripeDetailsSubmitted: true }),
  CONNECTED_INCOMPLETE: (key) => ({ stripeAccountId: `acct_demo_${key}`, stripeAccountStatus: "CONNECTED_INCOMPLETE" }),
  ERROR: (key) => ({ stripeAccountId: `acct_demo_${key}`, stripeAccountStatus: "ERROR", stripeDetailsSubmitted: true }),
  NOT_CONNECTED: () => ({ stripeAccountStatus: "NOT_CONNECTED" })
};

const storage = assetStorage();
const passwordHash = await hash("password123", 12);
let serial = 0;

async function removeDemoSocieties() {
  const ids = (await prisma.organisation.findMany({
    where: { slug: { startsWith: "demo-" }, accountUser: { is: { email: { endsWith: "@demo.example.com" } } } },
    select: { id: true }
  })).map((organisation) => organisation.id);
  if (ids.length === 0) return;
  const owned = { organisationId: { in: ids } };
  const purchase = { OR: [{ order: { is: owned } }, { commerceOrder: { is: owned } }] };
  const keys = await prisma.asset.findMany({ where: owned, select: { storageKey: true } });
  // Children before parents: purchase rows restrict their order, event, plan, product and society.
  await prisma.$transaction([
    prisma.notificationOutbox.deleteMany({ where: owned }),
    prisma.guestAccessGrant.deleteMany({ where: purchase }),
    prisma.checkoutAttempt.deleteMany({ where: purchase }),
    prisma.refundRequest.deleteMany({ where: owned }),
    prisma.purchaseDispute.deleteMany({ where: owned }),
    prisma.merchandiseReturn.deleteMany({ where: owned }),
    prisma.order.deleteMany({ where: owned }),
    prisma.membershipGrant.deleteMany({ where: owned }),
    prisma.commerceLifecycleEvent.deleteMany({ where: { commerceOrder: owned } }),
    prisma.commerceOrderLine.deleteMany({ where: owned }),
    prisma.commerceOrder.deleteMany({ where: owned }),
    prisma.merchandiseProductImage.deleteMany({ where: owned }),
    prisma.merchandiseVariant.deleteMany({ where: owned }),
    prisma.merchandiseProduct.deleteMany({ where: owned }),
    prisma.membershipProduct.deleteMany({ where: owned }),
    prisma.societyPayout.deleteMany({ where: owned }),
    prisma.event.deleteMany({ where: owned }),
    prisma.organisation.updateMany({ where: { id: { in: ids } }, data: { logoAssetId: null, coverAssetId: null } }),
    prisma.asset.deleteMany({ where: owned }),
    prisma.organisation.deleteMany({ where: { id: { in: ids } } })
  ]);
  for (const { storageKey } of keys) await storage.delete(storageKey);
  console.log(`Removed ${ids.length} demo societies from an earlier run.`);
}

async function account(email, data) {
  // A disabled or closed account stays as first made: the database refuses to reopen a closed one.
  const { closedAt, disabledAt, createdAt, ...update } = data;
  return prisma.user.upsert({
    where: { email },
    update: { password: passwordHash, ...update },
    create: { email, password: passwordHash, ...data },
    select: { id: true, email: true, firstName: true, lastName: true, displayName: true, authVersion: true }
  });
}

async function people() {
  const members = [];
  for (const [i, first] of firstNames.entries()) {
    const last = lastNames[i % lastNames.length];
    const since = ago((20 + i * 4) * day);
    // 0-51 verified with a profile; 52-55 unverified; 56-57 fresh sign-ups; 58 disabled; 59 closed.
    const named = i < 56 || i >= 58;
    const user = await account(`${first}.${last}@demo.example.com`.toLowerCase(), {
      accountRole: "member",
      createdAt: since,
      emailVerifiedAt: i < 52 || i >= 58 ? since : null,
      firstName: named ? first : null,
      lastName: named ? last : null,
      displayName: named && i % 6 === 0 ? `${first} ${last[0]}.` : null,
      phone: named && i % 3 === 0 ? `04${10000000 + i * 7919}` : null,
      studentNumber: named && i % 2 === 0 ? `s${4100000 + i * 37}` : null,
      onboardingCompletedAt: named ? since : null,
      ...(i === 58 ? { disabledAt: ago(10 * day) } : i === 59 ? { disabledAt: ago(30 * day), closedAt: ago(30 * day) } : {})
    });
    members.push({ ...user, userId: user.id, grants: [] });
  }
  const base = await prisma.user.findMany({
    where: { email: { in: ["member@example.com", "event.manager@example.com"] } },
    select: { id: true, email: true, firstName: true, lastName: true, displayName: true, authVersion: true }
  });
  if (base.length !== 2) throw new Error("Run `pnpm seed` first: the demo data uses its member@ and event.manager@ accounts.");
  const guests = [];
  for (const [i, [firstName, lastName]] of guestNames.entries()) {
    const email = `guest${String(i + 1).padStart(2, "0")}@demo.example.com`;
    const guest = await prisma.guestIdentity.upsert({ where: { email }, update: {}, create: { email, verifiedAt: ago((5 + i * 9) * day) } });
    guests.push({ guestIdentityId: guest.id, email, firstName, lastName, displayName: null, grants: [] });
  }
  return {
    members,
    buyers: members.slice(0, 52),
    guests,
    base: Object.fromEntries(base.map((user) => [user.email, { ...user, userId: user.id, grants: [] }]))
  };
}

// Circles in the society's colours. No text: the app image has no fonts for sharp to draw with.
function art(width, height, [ink, accent]) {
  const shapes = Array.from({ length: 7 }, () =>
    `<circle cx="${Math.round(random() * width)}" cy="${Math.round(random() * height)}" r="${Math.round((0.15 + random() * 0.35) * Math.min(width, height))}" fill="${accent}" fill-opacity="${(0.12 + random() * 0.3).toFixed(2)}"/>`
  ).join("");
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${ink}"/>${shapes}</svg>`)).png().toBuffer();
}

// Uploaded through the app's own service, so bytes, checks and audit rows match a real upload.
async function image(society, kind, width, height) {
  const asset = await uploadAsset(society.actor, society.id, kind, { bytes: await art(width, height, society.spec.colours), type: "image/png" });
  return asset.id;
}

async function history(model, key, id, entries) {
  await prisma[model].createMany({
    data: entries.map(([type, source, createdAt, extra = {}], index) => ({ [key]: id, sequence: index + 1, type, source, createdAt, ...extra }))
  });
}

function activeGrant(buyer, society, right, at) {
  return buyer.grants.find((grant) =>
    grant.organisationId === society.id && grant.entitlements.includes(right) && grant.grantedAt <= at &&
    grant.startsAt <= at && at < grant.endsAt && (!grant.revokedAt || at < grant.revokedAt)) ?? null;
}

async function buildSociety(spec, everyone) {
  const owner = await account(`${spec.key}.org@demo.example.com`, { accountRole: "organisation", createdAt: ago(spec.age * day), emailVerifiedAt: ago(spec.age * day) });
  const organisation = await prisma.organisation.create({
    data: { name: spec.name, slug: `demo-${spec.key}`, accountUserId: owner.id, createdAt: ago(spec.age * day), ...stripeFields[spec.stripe](spec.key) },
    select: { id: true, name: true, stripeAccountId: true }
  });
  const society = { ...organisation, spec, owner, supportEmail: "" };
  const staffUser = (who) => (typeof who === "number" ? everyone.members[who] : everyone.base[who]);
  await prisma.organisationMember.create({ data: { userId: owner.id, organisationId: society.id, role: "org_owner", createdAt: ago(spec.age * day) } });
  await prisma.organisationStaff.create({ data: { organisationId: society.id, userId: owner.id, role: "owner", acceptedAt: ago(spec.age * day), createdAt: ago(spec.age * day) } });
  for (const [who, role, status = "active"] of spec.staff ?? []) {
    const since = ago(Math.min(spec.age, 150) * day);
    await prisma.organisationStaff.create({ data: {
      organisationId: society.id, userId: staffUser(who).id, role, status, invitedById: owner.id, acceptedAt: since, createdAt: since,
      revokedAt: status === "revoked" ? ago(20 * day) : null, revokedById: status === "revoked" ? owner.id : null
    } });
  }
  for (const [email, role, expiresInDays] of spec.invites ?? []) {
    await prisma.organisationStaffInvite.create({ data: {
      organisationId: society.id, email, role, invitedById: owner.id, tokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
      createdAt: later(now, (expiresInDays - 7) * day), expiresAt: later(now, expiresInDays * day)
    } });
  }
  const staff = (role) => (spec.staff ?? []).find(([, staffRole, status]) => staffRole === role && !status);
  // Admins act where an owner may have MFA on (a re-run keeps it); refunds and cancellations come from finance.
  const actorUser = staff("admin") ? staffUser(staff("admin")[0]) : owner;
  society.actor = { id: actorUser.id, authVersion: actorUser.authVersion };
  const financeOrAdmin = staff("finance_manager") ?? staff("admin");
  society.staffActor = financeOrAdmin ? staffUser(financeOrAdmin[0]) : owner;

  const joined = shuffle(everyone.buyers).slice(0, spec.joins);
  if (spec.baseMember) joined.unshift(everyone.base["member@example.com"]);
  for (const member of joined) {
    await prisma.organisationMember.create({ data: { userId: member.userId, organisationId: society.id, role: "member", createdAt: between(ago(spec.age * day), ago(day)) } });
  }
  society.joined = joined;

  if (spec.profile) {
    const logoAssetId = spec.logo ? await image(society, "logo", 512, 512) : null;
    const coverAssetId = spec.cover ? await image(society, "cover", 1800, 600) : null;
    society.supportEmail = spec.profile.partial ? "" : `${spec.key}.org@demo.example.com`;
    await updateProfile(society.actor, society.id, {
      expectedProfileVersion: 1, name: spec.name, description: spec.profile.description, supportEmail: society.supportEmail,
      refundPolicy: spec.profile.refundPolicy ?? "", pickupPolicy: spec.profile.pickupPolicy ?? "", timeZone: "Australia/Brisbane", logoAssetId, coverAssetId
    });
  }

  for (const plan of spec.plans ?? []) await sellPlan(society, plan, everyone);
  for (const event of spec.events ?? []) await sellEvent(society, event, everyone);
  if (spec.products) await sellMerchandise(society, everyone);
  return society;
}

async function sellPlan(society, plan, everyone) {
  const publishedAt = plan.publishedDaysAgo ? ago(plan.publishedDaysAgo * day) : later(plan.term[0], -20 * day);
  const product = await prisma.membershipProduct.create({ data: {
    organisationId: society.id, name: plan.name, priceAmount: plan.price, startsAt: plan.term[0], endsAt: plan.term[1], entitlements: plan.rights,
    description: `Membership of ${society.name} from ${plan.term[0].getUTCFullYear()}: ${plan.rights.includes("members_only_events") ? "member prices and members-only events" : "member prices on tickets"}.`,
    status: plan.draft ? "draft" : plan.archived ? "archived" : "published", publishedAt: plan.draft ? null : publishedAt,
    archivedAt: plan.archived ? later(plan.term[1], 5 * day) : null, createdAt: later(publishedAt, -2 * day)
  } });
  const windowEnd = new Date(Math.min(now.getTime() - hour, plan.term[1].getTime()));
  const buyers = society.joined.filter((buyer) => buyer.email !== "member@example.com").slice(0, plan.grants ?? 0);
  if (plan.member) buyers.push(everyone.base["member@example.com"]);
  const line = { quantity: 1, unitAmount: plan.price, name: plan.name, termStartsAt: plan.term[0], termEndsAt: plan.term[1], membershipProductId: product.id };
  for (const [index, buyer] of buyers.entries()) {
    const state = index < (plan.refunded ?? 0) ? "refunded" : "paid";
    const at = between(publishedAt, windowEnd);
    const { lines, paidAt, followUp } = await commerceOrder(society, "membership", buyer, [line], state, at);
    // The first `refunded` buyers were refunded, the next `revoked` lost their membership without one.
    const revoked = state === "refunded" || index < (plan.refunded ?? 0) + (plan.revoked ?? 0);
    const revokedAt = revoked ? (state === "refunded" ? followUp : after(paidAt, 60)) : null;
    const grant = await prisma.membershipGrant.create({ data: {
      userId: buyer.userId, organisationId: society.id, membershipProductId: product.id, commerceOrderLineId: lines[0].id,
      startsAt: plan.term[0], endsAt: plan.term[1], entitlements: plan.rights, entitlementVersion: product.entitlementVersion, grantedAt: paidAt,
      revokedAt, revokedByUserId: revoked ? society.actor.id : null,
      revocationReason: revoked ? (state === "refunded" ? "Refunded at the member's request." : "Membership revoked after a code of conduct breach.") : null
    } });
    buyer.grants.push(grant);
  }
  for (let i = 0; i < (plan.incomplete ?? 0); i += 1) {
    await commerceOrder(society, "membership", pick(society.joined.slice(plan.grants ?? 0)) ?? pick(everyone.buyers), [line], i % 3 === 2 ? "failed" : "expired", between(publishedAt, windowEnd));
  }
}

async function sellEvent(society, spec, everyone) {
  const startTime = spec.live ? ago(70 * minute) : brisbane(spec.days, spec.at ?? 18);
  const endTime = later(startTime, (spec.live ? 3 : spec.hours ?? 2) * hour);
  const cancelledAt = spec.cancelled ? ago(spec.cancelled.daysAgo * day) : null;
  const close = new Date(Math.min(startTime.getTime(), now.getTime() - 10 * minute, cancelledAt?.getTime() ?? Infinity, spec.saleState === "closed" ? now.getTime() - 3 * day : Infinity));
  const open = new Date(Math.min(later(startTime, -(spec.lead ?? 35) * day).getTime(), close.getTime() - day));
  const createdAt = later(open, -2 * day);
  const heroAssetId = spec.hero ? await image(society, "event", 1600, 900) : null;
  const event = await prisma.event.create({
    data: {
      organisationId: society.id, title: spec.title, location: spec.place, startTime, endTime, salesCloseAt: startTime, createdAt,
      description: `${spec.title} with ${society.name} at ${spec.place}. ${ticketText}`,
      status: spec.status ?? "published", visibility: spec.visibility ?? "public", saleState: spec.cancelled || spec.saleState === "closed" ? "closed" : "open",
      capacity: spec.capacity ?? null, cancelledAt, cancellationReason: spec.cancelled?.reason ?? null, heroAssetId,
      ticketTypes: { create: spec.types.map(([name, price, quantity, memberPrice = null], index) => ({ name, price, quantity, memberPrice, createdAt: later(createdAt, index) })) }
    },
    include: { ticketTypes: { orderBy: { createdAt: "asc" } } }
  });
  if (heroAssetId) await prisma.asset.update({ where: { id: heroAssetId }, data: { unreferencedAt: null } });
  if (event.status === "draft") return;

  const left = new Map(event.ticketTypes.map((type) => [type.id, type.quantity]));
  let capacityLeft = spec.capacity ?? Infinity;
  const membersOnly = spec.visibility === "members_only";
  const pool = shuffle(membersOnly
    ? everyone.buyers.filter((buyer) => activeGrant(buyer, society, "members_only_events", close))
    : [...everyone.buyers, ...everyone.guests]);
  let next = 0;
  const sell = async (state, { buyer, type } = {}) => {
    // A state only a charge can reach needs a priced type; a cancellation needs a free one.
    const needs = !state || state === "paid" ? null : state === "cancelled" || state === "released" ? "free" : "paid";
    const available = event.ticketTypes.filter((option) => left.get(option.id) > 0 && (!needs || (option.price === 0) === (needs === "free")));
    if ((type ? left.get(type.id) <= 0 : available.length === 0) || capacityLeft <= 0 || (!buyer && pool.length === 0)) return false;
    type ??= weighted(available.map((option) => [option, left.get(option.id)]));
    buyer ??= pool[next++ % pool.length];
    const quantity = Math.min(weighted([[1, 62], [2, 26], [3, 7], [4, 5]]), left.get(type.id), capacityLeft);
    const earliest = membersOnly ? activeGrant(buyer, society, "members_only_events", close)?.grantedAt ?? open : open;
    const at = state === "pending" ? ago((2 + random() * 7) * minute) : between(new Date(Math.max(open.getTime(), earliest.getTime())), close);
    const outcome = await ticketOrder({ society, event, type, buyer, quantity, state, at });
    // Voided tickets go back on sale, except on a cancelled event.
    if (outcome.issued && (cancelledAt || !outcome.voided)) {
      left.set(type.id, left.get(type.id) - quantity);
      capacityLeft -= quantity;
    }
    return true;
  };
  for (let i = 0; i < (spec.sales ?? 0); i += 1) await sell();
  for (const state of spec.specials ?? []) await sell(state);
  if (spec.member) await sell(spec.member, { buyer: everyone.base["member@example.com"], type: event.ticketTypes[0] });
  if (spec.fill) {
    for (const type of event.ticketTypes.filter((option) => spec.fill === true || spec.fill.includes(option.name))) {
      while (left.get(type.id) > 0 && capacityLeft > 0 && (await sell("paid", { type })));
    }
  }
  for (const type of event.ticketTypes) await prisma.ticketType.update({ where: { id: type.id }, data: { quantity: left.get(type.id) } });
}

const issuedStates = new Set(["paid", "refunded", "refund_processing", "dispute_open", "dispute_won", "dispute_lost", "outside_refund", "cancelled", "released"]);
const voidReasons = { refunded: "refunded", dispute_lost: "dispute_lost", cancelled: "cancelled", released: "cancelled" };
const reviewReason = "Payment arrived after the reservation expired and the tickets had sold out.";

async function ticketOrder({ society, event, type, buyer, quantity, state, at }) {
  const grant = type.memberPrice !== null ? activeGrant(buyer, society, "member_prices", at) : null;
  const unitPrice = grant ? type.memberPrice : type.price;
  const total = unitPrice * quantity;
  const free = total === 0;
  state ??= free ? weighted([["paid", 93], ["released", 4], ["cancelled", 3]]) : weighted([["paid", 86], ["expired", 9], ["failed", 3], ["refunded", 2]]);
  // A free order is issued at once and can only be cancelled; a paid one is never "cancelled".
  if (free && !["paid", "cancelled", "released"].includes(state)) state = "paid";
  if (!free && ["cancelled", "released"].includes(state)) state = "paid";
  if (event.cancelledAt && state === "paid") state = free ? "cancelled" : "refunded";
  const n = (serial += 1);
  const issued = issuedStates.has(state);
  const charged = issued || state === "review";
  const paidAt = later(at, 2 * minute);
  const followUp = event.cancelledAt ? later(event.cancelledAt, 30 * minute) : after(paidAt);
  const staffActor = state === "released" ? null : society.staffActor;
  const reason = event.cancelledAt ? event.cancellationReason : state === "released" ? "Released by the buyer: plans changed." : "Cancelled by the society: duplicate registration.";
  const order = await prisma.order.create({ data: {
    organisationId: society.id, eventId: event.id, ticketTypeId: type.id, userId: buyer.userId ?? null, guestIdentityId: buyer.guestIdentityId ?? null,
    status: issued ? "paid" : state === "review" ? "failed" : state, quantity, unitPrice, totalAmount: total, createdAt: at,
    paymentKind: free ? "free" : "stripe",
    stripeSessionId: free || state === "pending" ? null : `cs_demo_${n}`,
    stripePaymentIntentId: !free && charged ? `pi_demo_${n}` : null,
    paidAt: charged ? paidAt : null,
    fulfilledAt: issued ? paidAt : null,
    failedAt: state === "failed" || state === "review" ? paidAt : null,
    failureReason: state === "failed" ? "Your card was declined." : state === "review" ? reviewReason : null,
    requiresCompensationReview: state === "review",
    fulfilmentFailedAt: state === "review" ? paidAt : null,
    fulfilmentFailureReason: state === "review" ? reviewReason : null,
    ticketEmailSentAt: issued ? later(paidAt, minute) : null,
    refundStatus: state === "refunded" ? "refunded" : state === "refund_processing" ? "processing" : null,
    disputeStatus: { dispute_open: "open", dispute_won: "won", dispute_lost: "lost" }[state] ?? null,
    externalRefundedAmount: state === "outside_refund" ? Math.round(total / 2) : 0,
    cancelledAt: free && state !== "paid" ? followUp : null,
    cancelledByUserId: free && state !== "paid" ? staffActor?.id ?? buyer.userId ?? null : null,
    cancellationReason: free && state !== "paid" ? reason : null,
    membershipGrantId: grant?.id ?? null, membershipEntitlementVersion: grant?.entitlementVersion ?? null,
    purchasedTicketTypeName: type.name, sellerName: society.name, sellerStripeAccountId: free ? null : society.stripeAccountId,
    feeAmount: free ? 0 : calculatePlatformFee(total, quantity), feePolicyVersion: free ? null : PLATFORM_FEE_POLICY_VERSION, snapshotVersion: PURCHASE_SNAPSHOT_VERSION,
    buyerEmailSnapshot: buyer.email, buyerFirstNameSnapshot: buyer.firstName, buyerLastNameSnapshot: buyer.lastName, buyerDisplayNameSnapshot: buyer.displayName,
    buyerIdentityCapturedAt: at, buyerIdentityProvenance: buyer.guestIdentityId ? "verified_guest" : "purchase"
  }, select: { id: true } });

  if (!free) {
    await prisma.ticketReservation.create({ data: {
      orderId: order.id, organisationId: society.id, eventId: event.id, ticketTypeId: type.id, userId: buyer.userId ?? null, quantity, createdAt: at,
      status: state === "pending" ? "active" : issued ? "confirmed" : state === "expired" ? "expired" : "released",
      expiresAt: state === "pending" ? later(now, 14 * minute) : later(at, 30 * minute),
      confirmedAt: issued ? paidAt : null,
      releasedAt: state === "expired" ? later(at, 31 * minute) : !issued && state !== "pending" ? paidAt : null,
      releaseReason: state === "expired" ? "Checkout expired" : !issued && state !== "pending" ? (state === "review" ? reviewReason : "Payment failed") : null
    } });
  }

  const voided = Boolean(voidReasons[state]);
  if (issued) {
    const validity = voided ? "void" : state === "dispute_open" || state === "dispute_won" ? "refund_review" : "active";
    const started = event.startTime <= now;
    await prisma.ticket.createMany({ data: Array.from({ length: quantity }, (_, index) => ({
      orderId: order.id, eventId: event.id, ticketTypeId: type.id, organisationId: society.id, issueSequence: index + 1, createdAt: paidAt,
      validity, validityReason: validity === "active" ? null : voidReasons[state] ?? "disputed", validityChangedAt: validity === "active" ? null : followUp,
      checkedInAt: validity === "active" && started && chance(event.endTime > now ? 0.55 : 0.85)
        ? between(later(event.startTime, -30 * minute), new Date(Math.min(now.getTime() - minute, event.startTime.getTime() + hour)))
        : null
    })) });
  }

  const actor = staffActor?.id ?? null;
  const entries = free
    ? [["order_created", "checkout", at, { toOrderStatus: "paid" }], ["free_fulfilled", "checkout", at, { toOrderStatus: "paid", facts: { ticketCount: quantity } }]]
    : [["order_created", "checkout", at, { toOrderStatus: "pending", toReservationStatus: "active" }], ...(state === "pending" ? [] : [["stripe_session_attached", "checkout", at, { stripeSessionId: `cs_demo_${n}` }]])];
  const fromPending = { fromOrderStatus: "pending", fromReservationStatus: "active" };
  if (!free && issued) entries.push(["payment_fulfilled", "stripe_webhook", paidAt, { ...fromPending, toOrderStatus: "paid", toReservationStatus: "confirmed", facts: { ticketCount: quantity } }]);
  if (state === "expired") entries.push(["order_expired", "stale_cleanup", later(at, 31 * minute), { ...fromPending, toOrderStatus: "expired", toReservationStatus: "expired" }]);
  if (state === "failed") entries.push(["order_failed", "stripe_webhook", paidAt, { ...fromPending, toOrderStatus: "failed", toReservationStatus: "released", reason: "Your card was declined." }]);
  if (state === "review") entries.push(["compensation_required", "stripe_webhook", paidAt, { ...fromPending, toOrderStatus: "failed", toReservationStatus: "released", reason: reviewReason }]);
  if (state === "refunded" || state === "refund_processing") {
    entries.push(["refund_requested", "staff_action", followUp, { actorUserId: actor, reason: event.cancelledAt ? reason : "Buyer can no longer attend." }]);
    entries.push(state === "refunded" ? ["refunded", "refund_worker", later(followUp, 5 * minute)] : ["refund_pending", "refund_worker", later(followUp, minute)]);
  }
  if (state.startsWith("dispute_")) {
    entries.push(["dispute_opened", "stripe_webhook", followUp]);
    if (state !== "dispute_open") entries.push(["dispute_closed", "stripe_webhook", new Date(Math.min(now.getTime() - minute, followUp.getTime() + 10 * day))]);
  }
  if (state === "outside_refund") entries.push(["external_refund_recorded", "stripe_webhook", followUp, { facts: { amount: Math.round(total / 2) } }]);
  if (state === "cancelled" || state === "released") entries.push(["free_cancelled", state === "released" ? "buyer_action" : "staff_action", followUp, { actorUserId: actor, reason }]);
  await history("orderLifecycleEvent", "orderId", order.id, entries);

  if (state === "refunded" || state === "refund_processing") {
    const succeeded = state === "refunded";
    await prisma.refundRequest.create({ data: {
      orderId: order.id, organisationId: society.id, amount: total, reason: event.cancelledAt ? reason : "Buyer can no longer attend.", actorUserId: actor,
      operationKey: `demo-refund-${n}`, status: succeeded ? "succeeded" : "pending", stripePaymentIntentId: `pi_demo_${n}`, stripeRefundId: succeeded ? `re_demo_${n}` : null,
      providerStatus: succeeded ? "succeeded" : null, resolvedAt: succeeded ? later(followUp, 5 * minute) : null, createdAt: followUp,
      // Far off, so a refund worker someone starts never asks Stripe about this fake payment.
      nextAttemptAt: succeeded ? followUp : later(now, 30 * day)
    } });
  }
  if (state.startsWith("dispute_")) {
    const lost = state === "dispute_lost";
    await prisma.purchaseDispute.create({ data: {
      orderId: order.id, organisationId: society.id, stripeDisputeId: `dp_demo_${n}`, stripeChargeId: `ch_demo_${n}`, amount: total, currency: "aud",
      reason: lost ? "fraudulent" : "product_not_received", providerStatus: { dispute_open: "needs_response", dispute_won: "won", dispute_lost: "lost" }[state],
      evidenceDueBy: state === "dispute_open" ? later(now, 7 * day) : null, closedAt: state === "dispute_open" ? null : new Date(Math.min(now.getTime() - minute, followUp.getTime() + 10 * day)),
      reversalStatus: lost ? "succeeded" : null, reversalAmount: lost ? total : null, stripeTransferReversalId: lost ? `trr_demo_${n}` : null, createdAt: followUp
    } });
  }
  if (state === "review") {
    await prisma.compensationRefundJob.create({ data: { orderId: order.id, state: "review_required", amount: total, stripePaymentIntentId: `pi_demo_${n}`, createdAt: paidAt } });
  }
  return { issued, voided };
}

async function commerceOrder(society, kind, buyer, lines, state, at, pickup = "pending") {
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitAmount, 0);
  const free = total === 0;
  const n = (serial += 1);
  const issued = state === "paid" || state === "refunded";
  const paidAt = later(at, 2 * minute);
  const followUp = after(paidAt, 30);
  const reason = state === "review" ? "Payment arrived after the order expired and the item had sold out." : "Your card was declined.";
  const order = await prisma.commerceOrder.create({ data: {
    organisationId: society.id, kind, userId: buyer.userId ?? null, guestIdentityId: buyer.guestIdentityId ?? null,
    status: issued ? "paid" : state === "review" ? "failed" : state, paymentKind: free ? "free" : "stripe", totalAmount: total,
    feeAmount: free ? 0 : calculatePlatformFee(total, 1), feePolicyVersion: free ? null : PLATFORM_FEE_POLICY_VERSION,
    buyerEmailSnapshot: buyer.email, buyerNameSnapshot: fullName(buyer), sellerName: society.name, sellerSupportEmail: society.supportEmail || null,
    sellerStripeAccountId: free ? null : society.stripeAccountId,
    expiresAt: free ? null : state === "pending" ? later(now, 25 * minute) : later(at, 30 * minute),
    stripeSessionId: free || state === "pending" ? null : `cs_demo_${n}`,
    stripePaymentIntentId: !free && (issued || state === "review") ? `pi_demo_${n}` : null,
    requiresCompensationReview: state === "review", reviewReason: state === "review" ? reason : null,
    version: kind === "merchandise" && issued ? { pending: 1, ready: 2, collected: 3 }[pickup] : 1,
    createdAt: at, paidAt: issued || state === "review" ? paidAt : null, fulfilledAt: issued ? paidAt : null,
    failedAt: state === "failed" || state === "review" ? paidAt : null, failureReason: state === "failed" || state === "review" ? reason : null,
    refundStatus: state === "refunded" ? "refunded" : null, pickupStatus: kind === "merchandise" && issued ? pickup : null
  } });
  const created = [];
  for (const [index, line] of lines.entries()) {
    created.push(await prisma.commerceOrderLine.create({ data: {
      orderId: order.id, organisationId: society.id, kind, lineNumber: index + 1, quantity: line.quantity, unitAmount: line.unitAmount,
      lineAmount: line.quantity * line.unitAmount, currency: "aud", nameSnapshot: line.name, variantSnapshot: line.variant ?? null,
      termStartsAt: line.termStartsAt ?? null, termEndsAt: line.termEndsAt ?? null, membershipProductId: line.membershipProductId ?? null,
      merchandiseVariantId: line.merchandiseVariantId ?? null, createdAt: at
    } }));
  }
  const actor = society.staffActor.id;
  const entries = [["order_created", "checkout", at, { toStatus: free ? "paid" : "pending", facts: { lineCount: lines.length, totalAmount: total } }]];
  if (!free && state !== "pending") entries.push(["stripe_session_attached", "checkout", at]);
  if (issued) entries.push([free ? "free_fulfilled" : "payment_fulfilled", free ? "checkout" : "stripe_webhook", paidAt, { fromStatus: free ? null : "pending", toStatus: "paid" }]);
  const readyAt = after(paidAt, 4);
  if (kind === "merchandise" && issued && pickup !== "pending") entries.push(["pickup_ready", "staff_action", readyAt, { actorUserId: actor }]);
  if (kind === "merchandise" && issued && pickup === "collected") entries.push(["pickup_collected", "staff_action", after(readyAt, 10), { actorUserId: actor }]);
  if (state === "expired") entries.push(["order_expired", "stale_cleanup", later(at, 31 * minute), { fromStatus: "pending", toStatus: "expired" }]);
  if (state === "failed") entries.push(["order_failed", "stripe_webhook", paidAt, { fromStatus: "pending", toStatus: "failed", reason }]);
  if (state === "review") entries.push(["compensation_required", "stripe_webhook", paidAt, { fromStatus: "pending", toStatus: "failed", reason }]);
  if (state === "refunded") {
    entries.push(["refund_requested", "staff_action", followUp, { actorUserId: actor, reason: "Refunded at the buyer's request." }]);
    entries.push(["refunded", "refund_worker", later(followUp, 5 * minute)]);
    await prisma.refundRequest.create({ data: {
      commerceOrderId: order.id, organisationId: society.id, amount: total, reason: "Refunded at the buyer's request.", actorUserId: actor,
      operationKey: `demo-refund-${n}`, status: "succeeded", stripePaymentIntentId: `pi_demo_${n}`, stripeRefundId: `re_demo_${n}`,
      providerStatus: "succeeded", resolvedAt: later(followUp, 5 * minute), nextAttemptAt: followUp, createdAt: followUp
    } });
  }
  await history("commerceLifecycleEvent", "commerceOrderId", order.id, entries);
  return { order, lines: created, paidAt, followUp };
}

async function sellMerchandise(society, everyone) {
  const variants = [];
  for (const product of society.spec.products) {
    const status = product.status ?? "published";
    const createdAt = ago(130 * day);
    const record = await prisma.merchandiseProduct.create({ data: {
      organisationId: society.id, name: product.name, description: `${product.name} from ${society.name}. Collect it in person; see the pickup details.`,
      status, publishedAt: status === "published" ? later(createdAt, day) : null, firstPublishedAt: status === "draft" ? null : later(createdAt, day),
      archivedAt: status === "archived" ? ago(40 * day) : null, createdAt
    } });
    const options = (product.colours ?? [""]).flatMap((colour) => (product.sizes ?? [""]).map((size) => ({ colour, size })));
    for (const [position, { colour, size }] of options.entries()) {
      const sku = [society.spec.key, product.name.replace(/[^A-Za-z]/g, "").slice(0, 8), colour, size].filter(Boolean).join("-").toUpperCase();
      const soldOut = product.soldOut?.includes(colour) || product.soldOut?.includes(size);
      const variant = await prisma.merchandiseVariant.create({ data: { productId: record.id, organisationId: society.id, colour, size, sku, priceAmount: product.price, remaining: product.stock, position, createdAt } });
      if (status === "published") variants.push({ ...variant, productName: product.name, label: [colour, size].filter(Boolean).join(" / ") || null, left: soldOut ? 0 : product.stock, soldOut });
    }
    for (let position = 0; position < (status === "archived" ? 0 : product.images ?? 1); position += 1) {
      const assetId = await image(society, "product", 800, 1000);
      await prisma.merchandiseProductImage.create({ data: { productId: record.id, organisationId: society.id, assetId, position } });
      await prisma.asset.update({ where: { id: assetId }, data: { unreferencedAt: null } });
    }
  }
  const pool = shuffle([...everyone.buyers, ...everyone.guests]);
  const orders = Array.from({ length: society.spec.merchOrders }, (_, i) => ({
    buyer: pool[i % pool.length], state: i === 0 ? "review" : i === 1 ? "pending" : weighted([["paid", 88], ["expired", 6], ["refunded", 4], ["failed", 2]])
  }));
  if (society.spec.baseMember && society.spec.key === "film") {
    orders.push({ buyer: everyone.base["member@example.com"], state: "paid", pickup: "ready" }, { buyer: everyone.base["member@example.com"], state: "paid", pickup: "collected" });
  }
  for (const { buyer, state, pickup } of orders) {
    const chosen = shuffle(variants.filter((variant) => variant.left > 0)).slice(0, chance(0.3) ? 2 : 1);
    if (chosen.length === 0) break;
    const lines = chosen.map((variant) => ({
      quantity: Math.min(chance(0.2) ? 2 : 1, variant.left), unitAmount: variant.priceAmount, name: variant.productName, variant: variant.label, merchandiseVariantId: variant.id
    }));
    // Skewed recent, so every pickup stage has a queue; older orders have mostly been collected.
    const at = state === "pending" ? ago(3 * minute) : ago(20 * minute + 100 * day * random() ** 2);
    const age = (now.getTime() - at.getTime()) / day;
    const stage = pickup ?? (age > 30 ? "collected" : age > 10 ? (chance(0.5) ? "ready" : "collected") : age > 3 && chance(0.5) ? "ready" : "pending");
    await commerceOrder(society, "merchandise", buyer, lines, state, at, stage);
    if (state === "paid" || state === "refunded") lines.forEach((line, index) => { chosen[index].left -= line.quantity; });
  }
  for (const variant of variants) await prisma.merchandiseVariant.update({ where: { id: variant.id }, data: { remaining: variant.left } });
}

// Owners with MFA enrol through the app's own begin and confirm; a re-run keeps an enrolled owner as is.
async function enrolMfa(society) {
  const { owner } = society;
  if ((await prisma.userMfa.findUnique({ where: { userId: owner.id }, select: { enabledAt: true } }))?.enabledAt) {
    return { email: owner.email, secret: "enrolled on an earlier run; that run printed the secret" };
  }
  const { secret, otpauthUrl } = await beginStaffMfaEnrollment(owner.id, owner.email);
  const { recoveryCodes } = await confirmStaffMfaEnrollment(owner.id, totpCode(secret, Math.floor(Date.now() / 30_000)), randomBytes(32).toString("hex"));
  return { email: owner.email, secret, otpauthUrl, recoveryCodes: recoveryCodes.join(" ") };
}

// Every condition the demo promises, so a change that drops one fails loudly.
async function checkCoverage() {
  const demo = { organisation: { is: { slug: { startsWith: "demo-" } } } };
  const orders = (where) => prisma.order.count({ where: { ...demo, ...where } });
  const merch = (where) => prisma.commerceOrder.count({ where: { ...demo, kind: "merchandise", ...where } });
  const events = (where) => prisma.event.count({ where: { ...demo, ...where } });
  const checks = {
    "paid ticket order": orders({ status: "paid", paymentKind: "stripe", refundStatus: null, disputeStatus: null }),
    "free ticket order": orders({ paymentKind: "free", cancelledAt: null }),
    "member-priced order": orders({ membershipGrantId: { not: null } }),
    "guest order": orders({ guestIdentityId: { not: null } }),
    "refunded order": orders({ refundStatus: "refunded" }),
    "refund in progress": orders({ refundStatus: "processing" }),
    "open dispute": orders({ disputeStatus: "open" }),
    "won dispute": orders({ disputeStatus: "won" }),
    "lost dispute": orders({ disputeStatus: "lost" }),
    "payment review": orders({ requiresCompensationReview: true }),
    "outside refund": orders({ externalRefundedAmount: { gt: 0 } }),
    "expired checkout": orders({ status: "expired" }),
    "failed checkout": orders({ status: "failed", requiresCompensationReview: false }),
    "checkout in progress": orders({ status: "pending" }),
    "cancelled free order": orders({ cancelledAt: { not: null } }),
    "checked-in ticket": prisma.ticket.count({ where: { ...demo, checkedInAt: { not: null } } }),
    "members-only event": events({ visibility: "members_only" }),
    "link-only event": events({ visibility: "unlisted" }),
    "draft event": events({ status: "draft" }),
    "cancelled event": events({ cancelledAt: { not: null } }),
    "sales-closed event": events({ saleState: "closed", cancelledAt: null }),
    "event in progress": events({ startTime: { lte: now }, endTime: { gt: now } }),
    "sold-out ticket type": prisma.ticketType.count({ where: { quantity: 0, event: { ...demo, status: "published" } } }),
    "active membership": prisma.membershipGrant.count({ where: { ...demo, startsAt: { lte: now }, endsAt: { gt: now }, revokedAt: null } }),
    "upcoming membership": prisma.membershipGrant.count({ where: { ...demo, startsAt: { gt: now } } }),
    "ended membership": prisma.membershipGrant.count({ where: { ...demo, endsAt: { lte: now } } }),
    "revoked membership": prisma.membershipGrant.count({ where: { ...demo, revokedAt: { not: null } } }),
    "pickup to prepare": merch({ status: "paid", pickupStatus: "pending", refundStatus: null }),
    "pickup ready": merch({ pickupStatus: "ready", refundStatus: null }),
    "pickup collected": merch({ pickupStatus: "collected" }),
    "pending invite": prisma.organisationStaffInvite.count({ where: { ...demo, expiresAt: { gt: now } } }),
    "expired invite": prisma.organisationStaffInvite.count({ where: { ...demo, expiresAt: { lte: now } } }),
    "revoked staff": prisma.organisationStaff.count({ where: { ...demo, status: "revoked" } })
  };
  const counts = Object.fromEntries(await Promise.all(Object.entries(checks).map(async ([label, count]) => [label, await count])));
  const missing = Object.keys(counts).filter((label) => counts[label] === 0);
  if (missing.length > 0) throw new Error(`Demo data is missing: ${missing.join(", ")}`);
  return counts;
}

try {
  await removeDemoSocieties();
  const everyone = await people();
  const built = [];
  for (const spec of societies) {
    built.push(await buildSociety(spec, everyone));
    console.log(`Built ${spec.name}.`);
  }
  const mfa = [];
  for (const society of built.filter((entry) => entry.spec.mfa)) mfa.push(await enrolMfa(society));
  const counts = await checkCoverage();
  const [ticketOrders, commerceOrders] = await Promise.all([
    prisma.order.count({ where: { organisation: { is: { slug: { startsWith: "demo-" } } } } }),
    prisma.commerceOrder.count({ where: { organisation: { is: { slug: { startsWith: "demo-" } } } } })
  ]);
  console.log(`\nDemo data loaded: ${built.length} societies, ${everyone.members.length} members, ${everyone.guests.length} guests, ${ticketOrders} ticket orders, ${commerceOrders} membership and merchandise orders.`);
  console.table(counts);
  console.log("Every demo account uses password123.");
  const member = (i) => everyone.members[i].email;
  console.table([
    { email: "film.org@demo.example.com", note: "Film Society owner (flagship, MFA on): every event, order, membership and pickup state" },
    { email: member(0), note: "Film Society admin (no MFA)" },
    { email: member(2), note: "Film Society finance manager" },
    { email: member(3), note: "Film Society check-in staff" },
    { email: "debating.org@demo.example.com", note: "Debating Society owner (MFA on): members-only events, memberships" },
    { email: "climbing.org@demo.example.com", note: "Climbing Club owner: merchandise shop and pickups" },
    { email: "volunteers.org@demo.example.com", note: "Volunteer Collective owner: free events, cancelled registrations" },
    { email: "chess.org@demo.example.com", note: "Chess Club owner: Stripe connected but incomplete" },
    { email: "gaming.org@demo.example.com", note: "Gaming Guild owner: Stripe account out of reach (ERROR)" },
    { email: "choir.org@demo.example.com", note: "Campus Choir owner: Stripe not connected, no profile" },
    { email: "astronomy.org@demo.example.com", note: "Astronomy Society owner: brand-new society, nothing yet" },
    { email: "member@example.com", note: "Base member: memberships and purchases in every state across Film, Debating, Climbing" },
    { email: member(52), note: "Unverified member" },
    { email: member(56), note: "Fresh sign-up: no name, not onboarded" },
    { email: member(58), note: "Disabled account" },
    { email: "guest01@demo.example.com", note: "Verified guest buyer (no account)" }
  ]);
  console.log("\nOwner MFA (add the secret to an authenticator app):");
  for (const entry of mfa) console.log(entry);
} finally {
  await prisma.$disconnect();
}
