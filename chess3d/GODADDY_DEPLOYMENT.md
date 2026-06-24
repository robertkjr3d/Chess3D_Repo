# GoDaddy Deployment Guide for Chess3D

## Backend (ASP.NET Core API)

### Files Ready
Your backend is published and ready in: `backend-aspnet/publish/`

### Native DLL — Stockfish_3D_Port.dll

**No port 5000 needed on GoDaddy.** IIS handles all traffic on port 80/443; ASP.NET Core Module (ANCM) bridges IIS to your app automatically via `web.config`. Your app never directly binds to port 5000 in production.

The `Stockfish_3D_Port.dll` is a native 64-bit Windows DLL loaded via P/Invoke. For it to work on GoDaddy:

1. **Confirm `Stockfish_3D_Port.dll` is in the publish output.**
   - Run `dotnet publish -c Release -o publish` and verify `Stockfish_3D_Port.dll` appears alongside `Chess3DBackend.dll`.
   - The `.csproj` `<Content CopyToOutputDirectory="PreserveNewest">` setting handles this automatically.

2. **Upload the DLL to GoDaddy** alongside the other publish files in your `chess3d-api` folder.

3. **Ensure the IIS App Pool is 64-bit.**
   - In Plesk / IIS Manager: find your application's App Pool → Advanced Settings → **Enable 32-Bit Applications = False** (must be False for 64-bit native DLL).
   - If you can't change this yourself, ask GoDaddy support: *"Please set the App Pool for the chess3d-api application to 64-bit (Enable 32-bit=False)."*

4. **If the DLL fails to load**, the backend gracefully falls back — `/api/ai/bestmove` returns HTTP 503, and the frontend's **Dumb AI** option still works fine.

### Step 1: Upload Backend to GoDaddy

1. **Connect via FTP** to your GoDaddy hosting
   - Use FileZilla or GoDaddy's File Manager

2. **Create API folder**
   - Navigate to your site root (usually `httpdocs` or `wwwroot`)
   - Create a new folder: `chess3d-api` (or just `api`)

3. **Upload ALL files** from `backend-aspnet/publish/` to the `chess3d-api` folder
   - Make sure `appsettings.Production.json` is included (it has your database connection)

### Step 2: Configure IIS on GoDaddy

**Note:** GoDaddy Windows Hosting Deluxe should have .NET Core support enabled by default. If you don't see specific .NET Core settings, that's normal - just follow the steps below.

1. **Log into GoDaddy Plesk Panel**
   - Go to your hosting control panel

2. **The simplest approach - Just upload and it may work!**
   - Upload the files to a folder (e.g., `chess3d-api`)
   - The `web.config` file in your publish folder should configure everything automatically
   - Try accessing `https://yourdomain.com/chess3d-api/health`
   - If it works, you're done! Skip the rest of this section.

3. **If you get errors, configure as IIS Application:**
   
   **Option A: Using Plesk File Manager**
   - Go to **Files** → **File Manager**
   - Navigate to your `chess3d-api` folder
   - Look for a gear/settings icon or right-click menu
   - Look for **"Convert to Application"** or **"Change to Virtual Application"**
   
   **Option B: Using IIS Manager (if available)**
   - Go to **Websites & Domains** → Your domain → **IIS Settings**
   - Find **Virtual Directories** or **Applications**
   - Find your `chess3d-api` folder
   - Convert it to an Application
   
   **Option C: Contact GoDaddy Support**
   - If you can't find these settings, ask GoDaddy support to:
     - "Please configure `/chess3d-api/` folder as an IIS Application"
     - They can do this in seconds from their end

### Step 3: Verify Backend Works

Visit these URLs (replace `yourdomain.com` with your actual domain):
- `https://yourdomain.com/chess3d-api/health` → Should return "OK"
- `https://yourdomain.com/chess3d-api/` → Should return JSON with API info

The database table will be created automatically on first run!

---

## Frontend (React App)

### Step 1: Update Frontend Configuration

Edit `frontend/src/config.js`:
```javascript
export const API_BASE_URL = 'https://yourdomain.com/chess3d-api';
```

Replace `yourdomain.com` with your actual GoDaddy domain.

### Step 2: Build Frontend for Production

```powershell
cd frontend
npm run build
```

This creates an optimized production build in `frontend/build/`

### Step 3: Upload Frontend to GoDaddy

1. **Connect via FTP** to GoDaddy

2. **Navigate to site root**
   - Usually `httpdocs` or `wwwroot`

3. **Upload ALL files** from `frontend/build/` folder to the root
   - Upload everything including:
     - `index.html`
     - `static/` folder
     - `models/` folder
     - `manifest.json`
     - `robots.txt`
     - etc.

### Step 4: Test Your Site

Visit your domain: `https://yourdomain.com`

The chess game should load and be able to save games to the database!

---

## Troubleshooting

### Backend Issues

**500 Error:**
- Check `logs/stdout.log` in your `chess3d-api` folder on GoDaddy
- Verify `ConnectionStrings__DefaultConnection` is set in Plesk environment variables

**Database Connection Failed:**
- Double-check the value of `ConnectionStrings__DefaultConnection` in Plesk:
   - Host: your MySQL host
   - Port: `3306`
   - Database: `chess3d`
   - User: your MySQL user
   - Password: your MySQL password

**404 on API calls:**
- The `web.config` should handle everything automatically
- If still having issues, the folder may need to be converted to an IIS Application
- Contact GoDaddy support - they can configure it quickly

**"HTTP Error 502.5 - ANCM Out-Of-Process Startup Failure":**
- This usually means .NET Core runtime is not installed on the server
- GoDaddy Deluxe should have it, but if not:
  - Contact GoDaddy support and ask them to enable .NET 8.0 support
  - Or ask if they can install the ASP.NET Core Hosting Bundle

### Frontend Issues

**CORS Errors:**
- Backend is configured to allow all origins, but if you see CORS errors, check that API_BASE_URL is correct

**Game not saving:**
- Open browser console (F12) and check for errors
- Make sure API_BASE_URL points to your actual API URL

---

## Your Configuration

**MySQL Database:**
- Host: `<set in secret manager / env var>`
- Database: `chess3d`
- User: `<set in secret manager / env var>`
- Password: `<set in secret manager / env var>`

**Backend API:** `/chess3d-api/` (or wherever you place it)

**Frontend:** Root of your domain

---

## Quick Checklist

- [ ] Backend published to `backend-aspnet/publish/`
- [ ] Backend uploaded to GoDaddy (e.g., `/chess3d-api/`)
- [ ] Folder converted to Application in IIS
- [ ] Backend health endpoint works (`/chess3d-api/health`)
- [ ] Frontend config updated with API URL
- [ ] Frontend built (`npm run build`)
- [ ] Frontend uploaded to GoDaddy root
- [ ] Site loads and games can be saved

---

Good luck with your deployment!
