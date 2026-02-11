// Backend API Configuration
// For local development: use empty string (relative URLs)
// For production on GoDaddy: use your Render backend URL

// Local development (backend running on localhost:3001)
// export const API_BASE_URL = '';

// Production (backend on Render)
export const API_BASE_URL = process.env.REACT_APP_API_URL || '';

// After deploying backend to Render, update .env file with:
// REACT_APP_API_URL=https://your-service-name.onrender.com
