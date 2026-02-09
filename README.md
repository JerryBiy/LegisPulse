## LegisPulse

This project tracks Georgia legislative bills using the LegiScan API.

### Setup

1. Install dependencies: `npm install`
2. Get a LegiScan API key from https://legiscan.com/legiscan
3. Create `.env` and add:
   ```
   VITE_LEGISCAN_API_KEY=your_api_key_here
   ```
4. Start dev server: `npm run dev`

> Tip: If you prefer keeping secrets out of git, use `.env.local` instead and keep it untracked.

### Features

- Sync bills from LegiScan API for Georgia legislature
- Track bills you're interested in
- Email notifications to client lists
- Mock Twitter feed monitoring (ready for real API integration)

### Mock vs Real Data

- **Mock mode**: Uses seed data in `localStorage` when LegiScan API key is not configured
- **LegiScan mode**: Click "Sync Bills from LegiScan" to fetch real Georgia bills
- User tracking, notifications, and email lists persist in browser storage

### Replacing the mock with a real backend

- The client in `src/api/base44Client.js` provides a browser-only mock API
- Replace method bodies under `auth`, `entities`, and `integrations` with calls to your backend
- Or keep using `localStorage` for a lightweight single-user setup
