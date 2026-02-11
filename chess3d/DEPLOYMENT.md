# Chess3D Deployment Guide

## Backend Deployment to Render

### Prerequisites
- GitHub account
- Render account (free tier available at https://render.com)

### Steps:

1. **Push backend code to GitHub**
   ```bash
   cd backend
   git init
   git add .
   git commit -m "Initial backend commit"
   git branch -M main
   git remote add origin <your-github-repo-url>
   git push -u origin main
   ```

2. **Deploy to Render**
   - Go to https://dashboard.render.com
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Select the `backend` folder (or root if you pushed only backend)
   - Render will auto-detect the `render.yaml` configuration
   - Click "Create Web Service"
   - Wait 2-3 minutes for deployment
   - Copy your service URL (e.g., `https://chess3d-backend.onrender.com`)

3. **Update Frontend to use Render backend**
   - Open `frontend/src/App.js`
   - Find the backend URL (search for `localhost:3001` or backend API calls)
   - Replace with your Render URL: `https://your-service-name.onrender.com`

4. **Deploy Frontend to GoDaddy**
   - Build the frontend:
     ```bash
     cd frontend
     npm run build
     ```
   - Upload the contents of `frontend/build/` to your GoDaddy hosting
   - Make sure all files including `index.html` are in the root web directory

### Important Notes:
- Render free tier: Backend sleeps after 15 min of inactivity (wakes up in ~30 seconds on first request)
- SQLite database persists on Render's disk (may reset on deployments - consider upgrading for persistent storage)
- For production, consider Render's paid plan ($7/month) for persistent disk storage

### Testing:
- Test backend: `https://your-service-name.onrender.com/health` (should return "OK")
- Test frontend: Visit your GoDaddy URL and play a game

### Alternative: Backend stays local (for development only)
If you want to keep backend running locally while frontend is on GoDaddy:
1. Don't deploy backend to Render
2. Use ngrok or similar to expose local backend to internet
3. Update frontend to use ngrok URL

**Recommended: Deploy to Render for production use**
