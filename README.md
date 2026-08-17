# PDFDesk — Free Online PDF Tools

Modern, fast & free PDF toolkit inspired by iLovePDF.  
Built for local development first, then easy deployment on Render (backend) + Vercel/Netlify (frontend).

## Tech Stack (Stage 1)

| Layer      | Technology              | Reason                                      |
|------------|-------------------------|---------------------------------------------|
| Backend    | Node.js + Express       | Lightweight, works great on Render free tier |
| PDF Engine | `pdf-lib`               | Pure JS, no native binaries needed          |
| Upload     | `multer` (memory)       | Files stay in RAM, never written to disk    |
| Frontend   | HTML + CSS + Vanilla JS | Simple, fast, zero build step               |

## Project Structure

```
pdfdesk/
├── README.md
├── backend/
│   ├── package.json
│   ├── server.js
│   ├── routes/
│   │   └── merge.js
│   ├── uploads/          ← empty (we use memory storage)
│   └── .gitignore
└── frontend/
    ├── index.html        ← Homepage (tool cards)
    ├── merge.html        ← Dedicated Merge PDF page
    ├── css/
    │   └── style.css
    ├── js/
    │   ├── main.js
    │   └── merge.js
    └── assets/
```

## Stage Roadmap

### ✅ Stage 1 (Current)
- Project structure
- Modern homepage
- Fully working **Merge PDF** (frontend + backend)
- Local run ready

### 🔜 Stage 2
- Split PDF
- Rotate PDF
- Compress PDF (basic)

### 🔜 Stage 3
- PDF ↔ JPG
- Watermark + Page Numbers
- Protect / Unlock

### 🔜 Stage 4
- Deployment (Render + Vercel)
- Polish + error handling

## How to Run Locally

```bash
# Backend
cd backend
npm install
npm run dev          # http://localhost:5050

# Frontend (any static server)
cd frontend
npx serve .          # or open index.html directly
```

## Important Rules
1. Never store files permanently — process in memory → send → discard.
2. Keep everything lightweight for free hosting tiers.
3. One tool = one route file.
