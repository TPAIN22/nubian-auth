# How to Start the Server

## Quick Start

1. **Open Terminal/PowerShell in the nubian-auth directory:**
   ```bash
   cd C:\Users\HUAWEI\Desktop\nubian-auth
   ```

2. **Start the server:**
   ```bash
   npm start
   ```

   Or for development with auto-reload:
   ```bash
   npm run dev
   ```

3. **Verify it's running:**
   - You should see: `Server started on port 5000`
   - Open browser: `http://localhost:5000/ping` → should return `pong`
   - Open browser: `http://192.168.0.115:5000/ping` → should return `pong`

## Check if Server is Running

```powershell
# Check if Node.js is running
Get-Process -Name node -ErrorAction SilentlyContinue

# Check if port 5000 is listening
netstat -an | findstr :5000
```

## Common Issues

### Port Already in Use
If you get "Port 5000 is already in use":
```bash
# Find what's using port 5000
netstat -ano | findstr :5000

# Kill the process (replace PID with actual process ID)
taskkill /PID <PID> /F
```

### Database Connection Error
Make sure:
- MongoDB is running
- `.env` file has correct `MONGODB_URI`
- Database credentials are correct

### Environment Variables
Create a `.env` file in `nubian-auth` directory:
```
PORT=5000
MONGODB_URI=your_mongodb_connection_string
CLERK_SECRET_KEY=your_clerk_secret
CORS_ORIGINS=http://localhost:3000,http://192.168.0.115:5000
```

## Testing the Connection

### From Your Computer:
```bash
curl http://localhost:5000/ping
# Should return: pong
```

### From Mobile Device (same Wi-Fi):
Open browser on mobile device:
```
http://192.168.0.115:5000/ping
# Should return: pong
```

If this works but the app doesn't, check:
1. App is using correct API URL
2. Firewall allows connections
3. Both devices on same network
