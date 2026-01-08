# Network Connection Troubleshooting

## Issue: ERR_NETWORK - Unable to connect to server

The mobile app is trying to connect to `http://192.168.0.115:5000/api` but getting a network error.

## Possible Causes & Solutions

### 1. Server Not Running
**Check:** Is the server actually running?

**Solution:**
```bash
cd C:\Users\HUAWEI\Desktop\nubian-auth
npm start
```

**Verify:** Check if you see:
```
Server started on port 5000
```

### 2. Wrong IP Address
**Check:** Your computer's IP might have changed.

**Solution - Find your current IP:**
```powershell
# Windows PowerShell
ipconfig | findstr IPv4
```

**Or:**
```bash
# Command Prompt
ipconfig
```

Look for your local network IP (usually starts with 192.168.x.x or 10.x.x.x)

### 3. Server Not Listening on Network Interface
**Check:** The server should listen on `0.0.0.0` (all interfaces)

**Current config:** ✅ Already correct in `src/index.js`:
```javascript
app.listen(PORT, '0.0.0.0', () => {
  // This allows connections from any network interface
});
```

### 4. Firewall Blocking Connection
**Check:** Windows Firewall might be blocking port 5000

**Solution:**
1. Open Windows Defender Firewall
2. Click "Advanced settings"
3. Click "Inbound Rules" → "New Rule"
4. Select "Port" → Next
5. Select "TCP" and enter port "5000"
6. Allow the connection
7. Apply to all profiles
8. Name it "Node.js Server"

**Or use PowerShell (Run as Administrator):**
```powershell
New-NetFirewallRule -DisplayName "Node.js Server" -Direction Inbound -LocalPort 5000 -Protocol TCP -Action Allow
```

### 5. Mobile Device Not on Same Network
**Check:** Both your computer and mobile device must be on the same Wi-Fi network

**Solution:**
- Connect both devices to the same Wi-Fi network
- Verify they can ping each other

### 6. CORS Configuration
**Current config:** ✅ Already allows mobile apps (null origin)

The server is configured to allow requests with no origin, which is correct for mobile apps.

## Quick Test Steps

### Step 1: Verify Server is Running
```bash
cd C:\Users\HUAWEI\Desktop\nubian-auth
npm start
```

### Step 2: Test from Browser
Open in browser: `http://192.168.0.115:5000/ping`
Should return: `pong`

### Step 3: Test from Mobile Device Browser
On your mobile device, open browser and go to:
`http://192.168.0.115:5000/ping`
Should return: `pong`

### Step 4: Check Server Logs
Look for connection attempts in the server logs. If you don't see any, the request isn't reaching the server.

## Alternative: Use Production Server

If local development is problematic, you can use the production server:

**Update `.env` or `app.json` in Nubian app:**
```
EXPO_PUBLIC_API_URL=https://nubian-lne4.onrender.com/api
```

## Network Debugging Commands

### Check if port is listening:
```powershell
netstat -an | findstr :5000
```

### Check firewall rules:
```powershell
Get-NetFirewallRule | Where-Object {$_.DisplayName -like "*5000*"}
```

### Test connection from another device:
```bash
# From mobile device or another computer
curl http://192.168.0.115:5000/ping
```

## Common Issues

1. **IP Changed After Reboot**: Your router might assign a new IP. Check `ipconfig` again.

2. **VPN Active**: If you're using a VPN, it might interfere. Try disabling it.

3. **Mobile Data vs Wi-Fi**: Make sure your mobile device is on Wi-Fi, not mobile data.

4. **Router Isolation**: Some routers have "AP Isolation" enabled, preventing devices from communicating. Check router settings.
