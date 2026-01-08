# Verify Server is Actually Running

## The Issue
The server log shows "Server started on port 5000" but the port isn't accepting connections.

## Quick Checks

### 1. Check Server Logs
Look at the terminal where you ran `npm start`. Check for:
- Any errors after "Server started"
- Database connection errors
- Any crash messages

### 2. Verify Server Process
```powershell
# Check if the server process is still running
Get-Process -Name node | Where-Object {$_.Path -like "*nubian-auth*"}

# Or check all node processes
Get-Process -Name node
```

### 3. Check if Port is Actually Listening
```powershell
# Should show port 5000 listening
netstat -ano | findstr :5000

# Look for: TCP    0.0.0.0:5000    or  TCP    [::]:5000
```

### 4. Test from Browser
Open browser and go to:
- `http://localhost:5000/ping` → Should return `pong`
- `http://192.168.0.115:5000/ping` → Should return `pong`

### 5. Check Server Logs for Errors
Look for any errors in the terminal output, especially:
- MongoDB connection errors
- Port already in use errors
- Any uncaught exceptions

## Common Issues

### Port Already in Use
If another process is using port 5000:
```powershell
# Find what's using port 5000
netstat -ano | findstr :5000

# Kill the process (replace PID with actual number)
taskkill /PID <PID> /F
```

### Server Crashed After Start
If the server started but then crashed, check:
1. Database connection - is MongoDB running?
2. Environment variables - is `.env` file correct?
3. Check full error logs in the terminal

### Firewall Blocking
Even if server is running, Windows Firewall might block connections:
```powershell
# Run as Administrator
New-NetFirewallRule -DisplayName "Node.js Server Port 5000" -Direction Inbound -LocalPort 5000 -Protocol TCP -Action Allow
```

## Next Steps

1. **Check the terminal output** where you ran `npm start` - look for any errors
2. **Verify the server process** is still running
3. **Test the connection** from browser
4. **Check firewall** settings

If the server is running but still not accessible, share the full terminal output so we can see what's happening.
