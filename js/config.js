/* ==========================================================================
   CONFIG  —  the only file you need to edit
   ==========================================================================
   Paste your Google OAuth Client ID between the quotes below.
   The setup guide walks you through getting it (takes about 10 minutes, once).

   This is NOT a secret. Client IDs for browser apps are public by design —
   Google only accepts it from the web address you registered, and nothing
   happens without you signing in and approving.
   ========================================================================== */

const CONFIG = {

  GOOGLE_CLIENT_ID: 'PASTE_YOUR_CLIENT_ID_HERE.apps.googleusercontent.com',

  // Names of the files this app creates in your Google Drive.
  SPREADSHEET_NAME: 'Laura CRM Data',
  DOCS_FOLDER_NAME: 'Laura CRM Documents',

  // A deal with no activity for this many days gets flagged on the board.
  STALE_DAYS: 14,
};


/* --- Everything below here is internal. You don't need to touch it. --- */

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

const DEFAULT_SETTINGS = {
  pipelines: {
    'Buyer': [
      'New Lead', 'Contacted', 'Qualifying', 'Showing Homes',
      'Offer Written', 'Under Contract', 'Closed', 'Lost',
    ],
    'Seller': [
      'New Lead', 'Listing Appt Booked', 'Listing Signed', 'Active Listing',
      'Offer Received', 'Under Contract', 'Closed', 'Lost',
    ],
  },
  contactTypes: ['Buyer', 'Seller', 'Both', 'Past Client', 'Referral Source'],
  sources: ['Referral', 'Open House', 'Sign Call', 'Website', 'Social Media',
            'Past Client', 'Realtor.ca', 'Farming', 'Other'],
  activityTypes: ['Call', 'Email', 'Showing', 'Meeting', 'Note', 'Task'],
};

// Stages that mean the deal is finished — hidden from the board by default.
const CLOSED_STAGES = ['Closed', 'Lost'];
