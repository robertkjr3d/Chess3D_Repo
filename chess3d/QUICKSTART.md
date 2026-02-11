# Quick Start: Deploy Chess3D to GoDaddy + Render

## Summary
- **Frontend**: Deploy to GoDaddy Windows Hosting
- **Backend**: Deploy to Render (free Node.js hosting)

## Step-by-Step

### 1. Deploy Backend to Render (5 minutes)

1. Create GitHub repo and push backend:
   ```bash
   cd backend
   git init
   git add .
   git commit -m "Chess3D backend"
   ```

2. Go to https://render.com → Sign up (free)

3. Click **"New +"** → **"Web Service"**

4. Connect your GitHub and select the repo

5. Settings:
   - **Name**: chess3d-backend
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - Click **"Create Web Service"**

6. Wait 2-3 minutes. Copy your URL (e.g., `https://chess3d-backend.onrender.com`)

### 2. Update Frontend with Backend URL

1. Edit `.env.production` file:
   ```
   REACT_APP_API_URL=https://your-actual-render-url.onrender.com
   ```
   *(Replace with your actual Render URL from step 1)*

### 3. Build Frontend

```bash
cd frontend
npm run build
```

This creates a `build/` folder with all files.

### 4. Upload to GoDaddy

1. Log in to GoDaddy cPanel/File Manager
2. Navigate to your web root (usually `public_html` or `httpdocs`)
3. Upload ALL files from `frontend/build/` folder:
   - `index.html`
   - `manifest.json`
   - `robots.txt`
   - All folders (`static/`, `models/`, etc.)
4. Make sure `index.html` is in the root directory

### 5. Test

- Visit your GoDaddy domain
- Game should load and save state to Render backend!

## Troubleshooting

**CORS errors?**
- Backend already has `cors()` enabled, should work

**Backend sleeping?**
- Render free tier sleeps after 15 min
- First request takes ~30 seconds to wake up
- Consider Render paid plan ($7/mo) for always-on

**Frontend showing old version?**
- Clear browser cache (Ctrl+Shift+R)
- Check that new build/ files uploaded

## Costs
- **Render free tier**: $0 (750 hrs/month, enough for one service)
- **GoDaddy**: You already have it
- **Total**: $0/month (or $7/month for Render paid tier with better performance)

## Development vs Production

**Local development:**
Leave `.env.production` empty or comment it out:
```
# REACT_APP_API_URL=
```
Run both locally:
- Terminal 1: `cd backend && node server.js`
- Terminal 2: `cd frontend && npm start`

**Production:**
Set the `.env.production` file with your Render URL and build with `npm run build`
