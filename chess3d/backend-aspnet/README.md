# ASP.NET Core Backend for Chess3D

## Local Development Setup

### Prerequisites
- .NET 8.0 SDK (download from https://dotnet.microsoft.com/download)
- MySQL Server (local or GoDaddy)

### Running Locally

1. **Update Connection String**
   Edit `appsettings.json` with your local MySQL credentials:
   ```json
   "ConnectionStrings": {
     "DefaultConnection": "Server=localhost;Database=chess3d;User=root;Password=Kangbote1984$$;"
   }
   ```

2. **Restore Packages**
   ```bash
   cd backend-aspnet
   dotnet restore
   ```

3. **Run the Application**
   ```bash
   dotnet run
   ```
   
   The API will be available at: `https://localhost:5001` or `http://localhost:5000`

4. **Test the API**
   - Open browser: `http://localhost:5000/health`
   - Swagger UI: `http://localhost:5000/swagger`

---

## GoDaddy Windows Hosting Deployment

### Step 1: Prepare MySQL Database

1. Log into your GoDaddy cPanel
2. Go to **Databases** → **MySQL Databases**
3. Create a new database:
   - Database name: `chess3d`
   - Create a database user with password
   - Grant ALL privileges to the user for this database
4. Note down:
   - MySQL Host: (usually `localhost` or specific hostname)
   - Database Name: `chess3d`
   - Username: (your created user)
   - Password: (your created password)

### Step 2: Update Production Configuration

Edit `appsettings.Production.json`:
```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Server=YOUR_GODADDY_MYSQL_HOST;Database=chess3d;User=YOUR_MYSQL_USERNAME;Password=Kangbote1984$$;"
  }
}
```

### Step 3: Publish the Application

Run this command in the `backend-aspnet` folder:
```bash
dotnet publish -c Release -o ./publish
```

This creates a `publish` folder with all files needed for deployment.

### Step 4: Upload to GoDaddy

1. Connect to your GoDaddy hosting via FTP (use FileZilla or similar)
2. Navigate to your site's root (usually `httpdocs` or `wwwroot`)
3. Create a subfolder for your API (e.g., `api` or `chess3d-api`)
4. Upload ALL files from the `publish` folder to this subfolder

### Step 5: Configure IIS on GoDaddy

1. Log into GoDaddy Plesk control panel
2. Go to **Domains** → Select your domain → **Hosting Settings**
3. Enable .NET Core support (GoDaddy Deluxe should have this)
4. Go to **IIS Settings** → **Application Pools**
5. Create or edit application pool:
   - .NET CLR Version: No Managed Code
   - Pipeline Mode: Integrated
6. Go to **Websites & Domains** → **Virtual Directories**
7. Convert your API folder to an Application:
   - Right-click folder → "Convert to Application"
   - Set the application pool created above

### Step 6: Test Your API

Visit your API URL:
- `https://yourdomain.com/api/health` (should return "OK")
- `https://yourdomain.com/api/` (should return JSON with status)

### Step 7: Update Frontend Configuration

Edit `frontend/src/config.js`:
```javascript
export const API_BASE_URL = 'https://yourdomain.com/api';
```

Then rebuild your frontend:
```bash
cd frontend
npm run build
```

Upload the contents of `frontend/build` to your GoDaddy site root.

---

## Troubleshooting

### "500 Internal Server Error"
- Check `logs/stdout.log` in your API folder on GoDaddy
- Verify MySQL connection string is correct
- Ensure .NET Core runtime is installed on GoDaddy

### "Cannot connect to database"
- Verify MySQL hostname (might be `127.0.0.1` instead of `localhost`)
- Check database user has proper permissions
- Try connecting to MySQL from GoDaddy's phpMyAdmin to verify credentials

### CORS Issues
- The backend is configured with `AllowAll` CORS policy
- If issues persist, check browser console for specific CORS errors

---

## API Endpoints

All endpoints match your existing Node.js backend:

- `GET /` - API info
- `GET /health` - Health check
- `POST /api/games` - Create new game or update existing
- `GET /api/games/{id}` - Get game by ID
- `PUT /api/games/{id}` - Update game

---

## Notes

- Database tables are created automatically on first run
- Game state is stored as JSON in MySQL TEXT column
- All timestamps are stored in UTC
- Owner tokens are GUIDs for security
