/* Test double for js/google.js — in-memory, no network. */

/* Calendar fixtures hang off the real current week so the tests stay true
   whatever day they are run. */
const _pad = (n) => String(n).padStart(2, '0');
const _iso = (d) => d.getFullYear() + '-' + _pad(d.getMonth() + 1) + '-' + _pad(d.getDate());
const _MON = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; })();
const WK = (n) => { const d = new Date(_MON); d.setDate(d.getDate() + n); return _iso(d); };
const AHEAD = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return _iso(d); };
const BIRTHDAY_OF = (iso, year) => year + iso.slice(4);

const MOCK = {
  Contacts: [
    { ID:'C-1', Name:'Dave Thompson', Type:'Buyer', Phone:'780-555-0111',
      Email:'dave.thompson@example.com', Address:'', Source:'Referral',
      Tags:'first-time buyer', Notes:'Pre-approved to 520k',
      Created:'2026-06-02', 'Last Contacted':'2026-08-20', 'Google ID':'people/c1',
      Birthday: BIRTHDAY_OF(WK(3), 1981), 'Touch Cadence':'' },
    { ID:'C-2', Name:'Priya Raman', Type:'Seller', Phone:'780-555-0122',
      Email:'priya.raman@example.com', Address:'9910 108 St NW, Edmonton',
      Source:'Open House', Tags:'downsizing', Notes:'',
      Created:'2026-05-11', 'Last Contacted':'2026-06-30', 'Google ID':'people/c2',
      Birthday:'', 'Touch Cadence':'Monthly' },
    { ID:'C-3', Name:'Marc Lefebvre', Type:'Both', Phone:'', Email:'',
      Address:'', Source:'Sign Call', Tags:'', Notes:'',
      Created:'2026-03-01', 'Last Contacted':'', 'Google ID':'',
      Birthday: BIRTHDAY_OF(AHEAD(20), 1969), 'Touch Cadence':'' },
  ],
  Deals: [
    { ID:'D-1', 'Contact ID':'C-1', 'Deal Name':'Dave T — Purchase', Pipeline:'Buyer',
      Stage:'Showing Homes', Value:'495000', 'Property Address':'',
      'Expected Close':'2026-09-30', Created:'2026-06-02',
      'Stage Updated':'2026-08-18', Notes:'Wants garage',
      Commission:'9400', GST:'470', 'Closed Date':'',
      'Conditions Due': WK(2), 'Possession Date':'' },
    { ID:'D-2', 'Contact ID':'C-2', 'Deal Name':'9910 108 St — Listing', Pipeline:'Seller',
      Stage:'Active Listing', Value:'615000', 'Property Address':'9910 108 St NW',
      'Expected Close':'2026-08-29', Created:'2026-05-12',
      'Stage Updated':'2026-06-15', Notes:'',
      Commission:'12300', GST:'615', 'Closed Date':'',
      'Conditions Due':'', 'Possession Date': WK(4) },
    { ID:'D-3', 'Contact ID':'C-3', 'Deal Name':'Lefebvre — Condo hunt', Pipeline:'Buyer',
      Stage:'New Lead', Value:'', 'Property Address':'', 'Expected Close':'',
      Created:'2026-03-01', 'Stage Updated':'2026-03-01', Notes:'' },
    { ID:'D-4', 'Contact ID':'C-1', 'Deal Name':'Old file', Pipeline:'Buyer',
      Stage:'Closed', Value:'380000', 'Property Address':'', 'Expected Close':'2026-02-01',
      Created:'2025-11-01', 'Stage Updated':'2026-02-03', Notes:'',
      Commission:'7600', GST:'380', 'Closed Date':'2026-02-03' },
  ],
  Activities: [
    { ID:'A-1','Contact ID':'C-1','Deal ID':'D-1',Type:'Showing',Date:'2026-08-18',
      Summary:'Showed 3 homes in Terwillegar','Gmail Thread ID':'',
      'Calendar Event ID':'ev1',Done:'yes' },
    { ID:'A-2','Contact ID':'C-1','Deal ID':'D-1',Type:'Call',Date:'2026-09-02',
      Summary:'Follow up on financing','Gmail Thread ID':'','Calendar Event ID':'',Done:'' },
    { ID:'A-3','Contact ID':'C-2','Deal ID':'D-2',Type:'Task',Date: WK(3),
      Summary:'Order new listing photos','Gmail Thread ID':'','Calendar Event ID':'',Done:'' },
  ],
  Settings: [],
};

const Auth = {
  user: { email: 'lauracrawleyrealestate@gmail.com', name: 'Laura Crawley' },
  init() {}, isSignedIn() { return true; },
  async signIn() { return this.user; },
  async loadProfile() { return this.user; },
  async ensureToken() { return 'mock'; },
  signOut() {},
};

async function api(url, options) {
  if (url.indexOf('drive/v3/files?q=') > -1) return { files: [] };

  // --- the source workbook the importer reads ---
  if (url.indexOf(SRC_ID) > -1) {
    if (url.indexOf('fields=sheets.properties.title') > -1) {
      return { sheets: SRC_TABS.map(t => ({ properties: { title: t } })) };
    }
    const rm = url.match(/\/values\/([^?]+)/);
    if (rm) {
      const title = decodeURIComponent(rm[1]).replace(/^'|'!A1:Z600$/g, '')
        .replace(/'!A1:Z600$/, '').replace(/^'/, '').replace(/'$/, '');
      const clean = title.replace(/!A1:Z600$/, '').replace(/^'|'$/g, '');
      return { values: SRC_ROWS[clean] || [] };
    }
    return {};
  }

  if (url.indexOf('people/me/connections') > -1) {
    return { connections: GPEOPLE, totalPeople: GPEOPLE.length };
  }
  if (url.indexOf('people:createContact') > -1) {
    const body = JSON.parse(options.body);
    const p = Object.assign({ resourceName: 'people/c' + (gNextId++), etag: 'new' }, body);
    GPEOPLE.push(p);
    return p;
  }
  if (url.indexOf(':updateContact') > -1) {
    const rn = url.split('/v1/')[1].split(':')[0];
    const body = JSON.parse(options.body);
    const i = GPEOPLE.findIndex(p => p.resourceName === rn);
    if (i >= 0) GPEOPLE[i] = Object.assign(GPEOPLE[i], body);
    return GPEOPLE[i];
  }
  // plain read of one person (used to fetch the etag before a patch)
  const m = url.match(/\/v1\/(people\/[^?]+)\?/);
  if (m) return GPEOPLE.find(p => p.resourceName === m[1]) || {};

  return {};
}

const jsonPost = (url, body, method = 'POST') => api(url, {
  method, headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const Drive = {
  async findFile() { return null; },
  async createFolder() { return { id: 'folder-1' }; },
  async ensureFolder() { return 'folder-root'; },
  async listFolder() { return []; },
  async uploadFile() { return { id: 'f1' }; },
};

const TABS = {
  Contacts: ['ID','Name','Type','Phone','Email','Address','Source','Tags','Notes','Created','Last Contacted','Google ID','Birthday','Touch Cadence'],
  Deals: ['ID','Contact ID','Deal Name','Pipeline','Stage','Value','Property Address','Expected Close','Created','Stage Updated','Notes','Commission','GST','Closed Date','Conditions Due','Possession Date'],
  Activities: ['ID','Contact ID','Deal ID','Type','Date','Summary','Gmail Thread ID','Calendar Event ID','Done'],
  Settings: ['Key','Value'],
};

/* --- Google Contacts (People API) fixtures --- */
/* Dave's phone is DIFFERENT from the CRM copy, so the sync has something to fix. */
const GPEOPLE = [
  { resourceName:'people/c1', etag:'e1',
    names:[{displayName:'Dave Thompson', givenName:'Dave', familyName:'Thompson'}],
    emailAddresses:[{value:'dave.thompson@example.com'}],
    phoneNumbers:[{value:'780-555-9999'}], addresses:[] },
  { resourceName:'people/c2', etag:'e2',
    names:[{displayName:'Priya Raman', givenName:'Priya', familyName:'Raman'}],
    emailAddresses:[{value:'priya.raman@example.com'}],
    phoneNumbers:[{value:'780-555-0122'}],
    addresses:[{formattedValue:'9910 108 St NW, Edmonton'}] },
  { resourceName:'people/c9', etag:'e9',
    names:[{displayName:'Sam Okafor', givenName:'Sam', familyName:'Okafor'}],
    emailAddresses:[{value:'sam.okafor@example.com'}],
    phoneNumbers:[{value:'780-555-0777'}], addresses:[],
    organizations:[{name:'Okafor Mortgages'}] },
  { resourceName:'people/c10', etag:'e10',
    names:[{displayName:'Dr Nina Patel', givenName:'Nina', familyName:'Patel'}],
    emailAddresses:[], phoneNumbers:[{value:'780-555-0300'}], addresses:[] },
];
let gNextId = 100;

/* A stand-in for Laura's tracker: same shape, same kinds of mess. */
const SRC_ID = 'srcbook123';
const SRC_TABS = ['Goal Setting Simplified', '1st Qtr. Sales', '2nd Qtr. Sales',
                  'Appointment Tracking', 'Reachouts'];
const SRC_ROWS = {
  '1st Qtr. Sales': [
    ['1ST QUARTER SALES TRACKER'],
    [],
    ['Date Deal Written','Property Address','Sale Price','Closing Date',
     'Seller/Buyer Name','Your Commission','GST','Source of Business','Buyer or Seller'],
    ['12/5/2025','1064 Cornerstone Way','$637,000.00','Jan 8th, 2026',
     'Nathan and Nicole Drader','$11863.45','$587.45','Referral:  Client ','Buyer'],
    ['1/7/2026','1704 89 Street, Edmonton','$390,000.00','Monday, March 2, 2026',
     'Pam Maloney','$7,968.70','379.46','Referral:  HS Friend','Seller'],
    ['1/10/2026','4 Cavelier Court, Beaumont','$575,000.00','March 17th, 2026',
     'Roz and Mike Stewart','$10782.45','513.45','Referral: family','Buyer'],
    ['1/17/2026','401, 7471 May Common','$432,000.00','March 23rd, 2026',
     'Roz and Mike','$8,530.20','406.2','Referral: family','Seller'],
    ['Avg. Sales Price','444250'],
    ['Total Commissions','$46,356'],
  ],
  '2nd Qtr. Sales': [
    ['2ND QUARTER SALES TRACKER'],
    [],
    ['Date Deal Written','Property Address','Sale Price','Closing Date',
     'Seller/Buyer Name','Your Commission','GST','Source of Business','Buyer or Seller'],
    ['April 17th, 2026','5408 64 street','$795,000.00','July 16th, 2026',
     'Jim and Kelli Stewart ','$14,239.58','678.08','Referral: family','Seller'],
    ['May 3rd  ','22 20 Georgian Way','$399,000.00','July 7th, 2026',
     'Carmen Cadieux','$7,978.95','379.95','Referral: family','Buyer '],
    ['Juky 31st, 2026 ','26410 TWP RD 512','$1,215,000.00','August 27th, 2026',
     'Dawn and Brent Campbell','$19,869.00','993.45','Referral - old acreage contact ','Buyer '],
    ['June 29th  ','84 Ridgehaven Cres','$600,000.00','August 7th, 2026',
     'Mike and Roz Stewart ','','','Referral: Sejal ',''],
    ['2nd Quarter Totals'],
  ],
  'Appointment Tracking': [
    ['APPOINTMENT TRACKER'],
    [],
    ['','Address/Notes:','Date:','New Appointment Type:','Source of Business:',
     'Listing Taken:','Added to Database:'],
    ['1','Roz and Mike Stewart','January 10, 2026','BUYER','Referral: family','PURCHASED','Yes'],
    ['2','Mike and Roz Stewart','January 17th, 2026','Seller','Referral: family','SOLD','Yes'],
    ['3','Nathan and Nicole Drader','January 8th, 2026','Buyer','Referral: Friend','PURCHASED','Yes'],
    ['4','','','','','',''],
  ],
};

const Sheets = {
  id: 'mock-sheet',
  writes: [],
  async connect() { return this.id; },
  async read(tab) { return JSON.parse(JSON.stringify(MOCK[tab] || [])); },
  async write(tab, records) {
    this.writes.push(tab);
    MOCK[tab] = JSON.parse(JSON.stringify(records));
    return true;
  },
  url() { return 'https://docs.google.com/spreadsheets/d/mock-sheet'; },
};

const GmailApi = {
  async threadsWith(email) {
    return [{ id:'t1', subject:'Re: 123 Maple St', from:email, date:'Aug 20, 2026',
              snippet:'Sounds good, see you Tuesday', count:3,
              link:'https://mail.google.com/mail/u/0/#inbox/t1' }];
  },
  async send() { return { id: 'm1' }; },
};

let MOCK_EVENTS = [
  { id:'ev1', title:'Showing — 3 homes, Terwillegar', date: WK(1), time:'10:00 a.m.',
    allDay:false, location:'Terwillegar', link:'' },
  { id:'ev-dentist', title:'Dentist', date: WK(2), time:'2:00 p.m.',
    allDay:false, location:'', link:'' },
  { id:'ev-open', title:'Open house 9910 108 St', date: WK(5), time:'1:00 p.m.',
    allDay:false, location:'9910 108 St NW', link:'' },
];

const CalendarApi = {
  async create({ title, startISO }) {
    const id = 'ev-' + (MOCK_EVENTS.length + 1);
    MOCK_EVENTS.push({ id, title, date: String(startISO).slice(0, 10),
                       time:'9:00 a.m.', allDay:false, location:'', link:'' });
    return { id };
  },
  async upcoming() { return []; },
  async range(fromISO, toISO) {
    return MOCK_EVENTS.filter(e => e.date >= fromISO && e.date <= toISO)
      .map(e => Object.assign({}, e));
  },
};
