/* Test double for js/google.js — in-memory, no network. */

const MOCK = {
  Contacts: [
    { ID:'C-1', Name:'Dave Thompson', Type:'Buyer', Phone:'780-555-0111',
      Email:'dave.thompson@example.com', Address:'', Source:'Referral',
      Tags:'first-time buyer', Notes:'Pre-approved to 520k',
      Created:'2026-06-02', 'Last Contacted':'2026-08-20' },
    { ID:'C-2', Name:'Priya Raman', Type:'Seller', Phone:'780-555-0122',
      Email:'priya.raman@example.com', Address:'9910 108 St NW, Edmonton',
      Source:'Open House', Tags:'downsizing', Notes:'',
      Created:'2026-05-11', 'Last Contacted':'2026-06-30' },
    { ID:'C-3', Name:'Marc Lefebvre', Type:'Both', Phone:'', Email:'',
      Address:'', Source:'Sign Call', Tags:'', Notes:'',
      Created:'2026-03-01', 'Last Contacted':'' },
  ],
  Deals: [
    { ID:'D-1', 'Contact ID':'C-1', 'Deal Name':'Dave T — Purchase', Pipeline:'Buyer',
      Stage:'Showing Homes', Value:'495000', 'Property Address':'',
      'Expected Close':'2026-09-30', Created:'2026-06-02',
      'Stage Updated':'2026-08-18', Notes:'Wants garage' },
    { ID:'D-2', 'Contact ID':'C-2', 'Deal Name':'9910 108 St — Listing', Pipeline:'Seller',
      Stage:'Active Listing', Value:'615000', 'Property Address':'9910 108 St NW',
      'Expected Close':'2026-08-29', Created:'2026-05-12',
      'Stage Updated':'2026-06-15', Notes:'' },
    { ID:'D-3', 'Contact ID':'C-3', 'Deal Name':'Lefebvre — Condo hunt', Pipeline:'Buyer',
      Stage:'New Lead', Value:'', 'Property Address':'', 'Expected Close':'',
      Created:'2026-03-01', 'Stage Updated':'2026-03-01', Notes:'' },
    { ID:'D-4', 'Contact ID':'C-1', 'Deal Name':'Old file', Pipeline:'Buyer',
      Stage:'Closed', Value:'380000', 'Property Address':'', 'Expected Close':'2026-02-01',
      Created:'2025-11-01', 'Stage Updated':'2026-02-03', Notes:'' },
  ],
  Activities: [
    { ID:'A-1','Contact ID':'C-1','Deal ID':'D-1',Type:'Showing',Date:'2026-08-18',
      Summary:'Showed 3 homes in Terwillegar','Gmail Thread ID':'',
      'Calendar Event ID':'ev1',Done:'yes' },
    { ID:'A-2','Contact ID':'C-1','Deal ID':'D-1',Type:'Call',Date:'2026-09-02',
      Summary:'Follow up on financing','Gmail Thread ID':'','Calendar Event ID':'',Done:'' },
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

async function api(url) {
  if (url.indexOf('drive/v3/files?q=') > -1) return { files: [] };
  return {};
}

const Drive = {
  async findFile() { return null; },
  async createFolder() { return { id: 'folder-1' }; },
  async ensureFolder() { return 'folder-root'; },
  async listFolder() { return []; },
  async uploadFile() { return { id: 'f1' }; },
};

const TABS = {
  Contacts: ['ID','Name','Type','Phone','Email','Address','Source','Tags','Notes','Created','Last Contacted'],
  Deals: ['ID','Contact ID','Deal Name','Pipeline','Stage','Value','Property Address','Expected Close','Created','Stage Updated','Notes'],
  Activities: ['ID','Contact ID','Deal ID','Type','Date','Summary','Gmail Thread ID','Calendar Event ID','Done'],
  Settings: ['Key','Value'],
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

const CalendarApi = {
  async create() { return { id: 'ev-new' }; },
  async upcoming() { return []; },
};
