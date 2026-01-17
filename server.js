const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'voicelink123';

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ============= ANALYTICS TRACKING =============

const analytics = {
    totalCallsToday: 0,
    totalCallsAllTime: 0,
    totalSkipsToday: 0,
    totalReportsToday: 0,
    totalExtendsToday: 0,
    callDurations: [], // Store last 100 call durations for average
    peakOnlineUsers: 0,
    serverStartTime: Date.now(),
    lastResetDate: new Date().toDateString()
};

// Reset daily stats at midnight
function resetDailyStats() {
    const today = new Date().toDateString();
    if (analytics.lastResetDate !== today) {
        analytics.totalCallsToday = 0;
        analytics.totalSkipsToday = 0;
        analytics.totalReportsToday = 0;
        analytics.totalExtendsToday = 0;
        analytics.lastResetDate = today;
    }
}

// Calculate average call duration
function getAvgCallDuration() {
    if (analytics.callDurations.length === 0) return 0;
    const sum = analytics.callDurations.reduce((a, b) => a + b, 0);
    return Math.round(sum / analytics.callDurations.length);
}

// Format seconds to mm:ss
function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
}

// ============= ADMIN DASHBOARD ROUTE =============

app.get('/admin', (req, res) => {
    const password = req.query.key;

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>VoiceLink Admin</title>
                <style>
                    body { font-family: Arial; background: #0a0a0f; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                    .login { background: rgba(20,20,35,0.9); padding: 40px; border-radius: 16px; text-align: center; }
                    input { padding: 12px; margin: 10px 0; border-radius: 8px; border: 1px solid #333; background: #1a1a2e; color: #fff; width: 200px; }
                    button { padding: 12px 24px; background: #6366f1; border: none; border-radius: 8px; color: #fff; cursor: pointer; }
                </style>
            </head>
            <body>
                <div class="login">
                    <h2>🔐 Admin Login</h2>
                    <form method="GET">
                        <input type="password" name="key" placeholder="Enter password" required><br>
                        <button type="submit">Login</button>
                    </form>
                </div>
            </body>
            </html>
        `);
    }

    resetDailyStats();

    const onlineUsers = Object.keys(userData).length;
    const usersInQueue = waitingQueue.length;
    const activeCalls = Object.keys(activeRooms).length;
    const skipRate = analytics.totalCallsToday > 0
        ? Math.round((analytics.totalSkipsToday / analytics.totalCallsToday) * 100)
        : 0;
    const extendRate = analytics.totalCallsToday > 0
        ? Math.round((analytics.totalExtendsToday / analytics.totalCallsToday) * 100)
        : 0;

    // Update peak users
    if (onlineUsers > analytics.peakOnlineUsers) {
        analytics.peakOnlineUsers = onlineUsers;
    }

    const uptimeSeconds = Math.floor((Date.now() - analytics.serverStartTime) / 1000);
    const uptimeHours = Math.floor(uptimeSeconds / 3600);
    const uptimeMins = Math.floor((uptimeSeconds % 3600) / 60);

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>VoiceLink Admin Dashboard</title>
            <meta http-equiv="refresh" content="10">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { 
                    font-family: 'Segoe UI', Arial, sans-serif; 
                    background: linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 100%); 
                    color: #fff; 
                    min-height: 100vh;
                    padding: 40px;
                }
                .header { 
                    text-align: center; 
                    margin-bottom: 40px;
                }
                .header h1 { 
                    font-size: 2rem; 
                    background: linear-gradient(135deg, #6366f1, #8b5cf6);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }
                .header p { color: #888; margin-top: 8px; }
                .grid { 
                    display: grid; 
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); 
                    gap: 20px; 
                    max-width: 1200px; 
                    margin: 0 auto;
                }
                .card { 
                    background: rgba(30, 30, 50, 0.8); 
                    border-radius: 16px; 
                    padding: 24px;
                    border: 1px solid rgba(255,255,255,0.1);
                }
                .card-label { 
                    font-size: 0.875rem; 
                    color: #888; 
                    text-transform: uppercase; 
                    letter-spacing: 1px;
                }
                .card-value { 
                    font-size: 2.5rem; 
                    font-weight: 700; 
                    margin-top: 8px;
                }
                .card-value.green { color: #22c55e; }
                .card-value.blue { color: #6366f1; }
                .card-value.orange { color: #f97316; }
                .card-value.red { color: #ef4444; }
                .card-value.purple { color: #a855f7; }
                .section-title { 
                    font-size: 1.25rem; 
                    margin: 40px 0 20px; 
                    color: #888;
                    max-width: 1200px;
                    margin-left: auto;
                    margin-right: auto;
                }
                .footer { 
                    text-align: center; 
                    margin-top: 40px; 
                    color: #555; 
                    font-size: 0.875rem;
                }
                .live-dot {
                    display: inline-block;
                    width: 10px;
                    height: 10px;
                    background: #22c55e;
                    border-radius: 50%;
                    margin-right: 8px;
                    animation: pulse 1.5s infinite;
                }
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>📊 VoiceLink Admin Dashboard</h1>
                <p><span class="live-dot"></span>Live - Auto-refreshes every 10 seconds</p>
            </div>
            
            <div class="section-title">🟢 Real-Time Status</div>
            <div class="grid">
                <div class="card">
                    <div class="card-label">Online Users</div>
                    <div class="card-value green">${onlineUsers}</div>
                </div>
                <div class="card">
                    <div class="card-label">In Queue</div>
                    <div class="card-value blue">${usersInQueue}</div>
                </div>
                <div class="card">
                    <div class="card-label">Active Calls</div>
                    <div class="card-value purple">${activeCalls}</div>
                </div>
                <div class="card">
                    <div class="card-label">Peak Users Today</div>
                    <div class="card-value orange">${analytics.peakOnlineUsers}</div>
                </div>
            </div>
            
            <div class="section-title">📈 Today's Stats</div>
            <div class="grid">
                <div class="card">
                    <div class="card-label">Calls Today</div>
                    <div class="card-value blue">${analytics.totalCallsToday}</div>
                </div>
                <div class="card">
                    <div class="card-label">Avg Call Duration</div>
                    <div class="card-value green">${formatDuration(getAvgCallDuration())}</div>
                </div>
                <div class="card">
                    <div class="card-label">Skip Rate</div>
                    <div class="card-value orange">${skipRate}%</div>
                </div>
                <div class="card">
                    <div class="card-label">Extend Rate</div>
                    <div class="card-value purple">${extendRate}%</div>
                </div>
            </div>
            
            <div class="section-title">🚩 Moderation</div>
            <div class="grid">
                <div class="card">
                    <div class="card-label">Reports Today</div>
                    <div class="card-value red">${analytics.totalReportsToday}</div>
                </div>
                <div class="card">
                    <div class="card-label">Total Calls (All Time)</div>
                    <div class="card-value blue">${analytics.totalCallsAllTime}</div>
                </div>
                <div class="card">
                    <div class="card-label">Server Uptime</div>
                    <div class="card-value green">${uptimeHours}h ${uptimeMins}m</div>
                </div>
            </div>
            
            <div class="footer">
                VoiceLink Admin Dashboard • Last updated: ${new Date().toLocaleTimeString()}
            </div>
        </body>
        </html>
    `);
});

// ============= MATCHING SYSTEM =============

// Queue for users waiting to be matched
let waitingQueue = [];

// Active rooms: { roomId: { users: [socketId1, socketId2], timerEnd: timestamp, startTime: timestamp } }
let activeRooms = {};

// User data: { socketId: { interests: [], roomId: null, blockedUsers: [], reportCount: 0 } }
let userData = {};

// Generate unique room ID
function generateRoomId() {
    return 'room_' + Math.random().toString(36).substring(2, 15);
}

// Calculate interest match score
function getInterestScore(interests1, interests2) {
    if (!interests1.length || !interests2.length) return 0;
    const set1 = new Set(interests1.map(i => i.toLowerCase()));
    let matches = 0;
    for (const interest of interests2) {
        if (set1.has(interest.toLowerCase())) matches++;
    }
    return matches;
}

// Find best match for a user
function findMatch(socket) {
    const user = userData[socket.id];
    if (!user) return null;

    // Filter out blocked users
    const availableUsers = waitingQueue.filter(s => {
        const otherUser = userData[s.id];
        if (!otherUser) return false;
        if (s.id === socket.id) return false;
        if (user.blockedUsers.includes(s.id)) return false;
        if (otherUser.blockedUsers.includes(socket.id)) return false;
        return true;
    });

    if (availableUsers.length === 0) return null;

    // If user has interests, try to find best match
    if (user.interests.length > 0) {
        let bestMatch = null;
        let bestScore = -1;

        for (const candidate of availableUsers) {
            const candidateData = userData[candidate.id];
            const score = getInterestScore(user.interests, candidateData.interests || []);
            if (score > bestScore) {
                bestScore = score;
                bestMatch = candidate;
            }
        }

        // Return best match (even if score is 0, at least we tried)
        return bestMatch;
    }

    // Random match - return first available
    return availableUsers[0];
}

// Create a room for two users
function createRoom(socket1, socket2) {
    const roomId = generateRoomId();

    // Remove from waiting queue
    waitingQueue = waitingQueue.filter(s => s.id !== socket1.id && s.id !== socket2.id);

    // Setup room with analytics tracking
    activeRooms[roomId] = {
        users: [socket1.id, socket2.id],
        timerEnd: Date.now() + 5 * 60 * 1000, // 5 minutes
        extendRequests: new Set(),
        startTime: Date.now() // For duration tracking
    };

    // Update analytics
    analytics.totalCallsToday++;
    analytics.totalCallsAllTime++;

    // Update user data
    userData[socket1.id].roomId = roomId;
    userData[socket2.id].roomId = roomId;

    // Join socket.io room
    socket1.join(roomId);
    socket2.join(roomId);

    // Notify both users - socket1 creates offer
    socket1.emit('matched', { roomId, isInitiator: true, timerEnd: activeRooms[roomId].timerEnd });
    socket2.emit('matched', { roomId, isInitiator: false, timerEnd: activeRooms[roomId].timerEnd });

    console.log(`Room created: ${roomId} with users ${socket1.id} and ${socket2.id}`);
}

// Leave current room
function leaveRoom(socket, reason = 'left') {
    const user = userData[socket.id];
    if (!user || !user.roomId) return;

    const roomId = user.roomId;
    const room = activeRooms[roomId];

    if (room) {
        // Track call duration for analytics
        if (room.startTime) {
            const durationSeconds = Math.floor((Date.now() - room.startTime) / 1000);
            analytics.callDurations.push(durationSeconds);
            // Keep only last 100 durations
            if (analytics.callDurations.length > 100) {
                analytics.callDurations.shift();
            }
        }

        // Notify other user
        socket.to(roomId).emit('partnerLeft', { reason });

        // Get other user and clean up
        const otherUserId = room.users.find(id => id !== socket.id);
        if (otherUserId && userData[otherUserId]) {
            userData[otherUserId].roomId = null;
        }

        // Cleanup room
        delete activeRooms[roomId];
    }

    socket.leave(roomId);
    user.roomId = null;
}

// ============= SOCKET HANDLERS =============

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Initialize user data
    userData[socket.id] = {
        interests: [],
        roomId: null,
        blockedUsers: [],
        reportCount: 0
    };

    // User wants to start matching
    socket.on('startMatching', (data) => {
        const { interests = [] } = data || {};
        userData[socket.id].interests = interests;

        // Add to queue if not already
        if (!waitingQueue.find(s => s.id === socket.id)) {
            waitingQueue.push(socket);
        }

        // Try to find a match
        const match = findMatch(socket);
        if (match) {
            createRoom(socket, match);
        } else {
            socket.emit('waiting');
        }

        console.log(`User ${socket.id} started matching with interests: ${interests.join(', ')}`);
    });

    // WebRTC signaling - offer
    socket.on('offer', (data) => {
        const { roomId, offer } = data;
        socket.to(roomId).emit('offer', { offer });
    });

    // WebRTC signaling - answer
    socket.on('answer', (data) => {
        const { roomId, answer } = data;
        socket.to(roomId).emit('answer', { answer });
    });

    // WebRTC signaling - ICE candidate
    socket.on('iceCandidate', (data) => {
        const { roomId, candidate } = data;
        socket.to(roomId).emit('iceCandidate', { candidate });
    });

    // User wants to skip current partner
    socket.on('skip', () => {
        leaveRoom(socket, 'skipped');
        analytics.totalSkipsToday++; // Track skip

        // Re-add to queue
        if (!waitingQueue.find(s => s.id === socket.id)) {
            waitingQueue.push(socket);
        }

        // Try to find new match
        const match = findMatch(socket);
        if (match) {
            createRoom(socket, match);
        } else {
            socket.emit('waiting');
        }
    });

    // Timer extend request
    socket.on('requestExtend', () => {
        const user = userData[socket.id];
        if (!user || !user.roomId) return;

        const room = activeRooms[user.roomId];
        if (!room) return;

        room.extendRequests.add(socket.id);

        // Check if both users requested
        if (room.extendRequests.size >= 2) {
            // Extend timer by 5 minutes
            room.timerEnd += 5 * 60 * 1000;
            room.extendRequests.clear();
            analytics.totalExtendsToday++; // Track extend

            io.to(user.roomId).emit('timerExtended', { timerEnd: room.timerEnd });
            console.log(`Timer extended in room ${user.roomId}`);
        } else {
            // Notify the other user
            socket.to(user.roomId).emit('partnerRequestedExtend');
        }
    });

    // Report user
    socket.on('report', (data) => {
        const user = userData[socket.id];
        if (!user || !user.roomId) return;

        const room = activeRooms[user.roomId];
        if (!room) return;

        const reportedUserId = room.users.find(id => id !== socket.id);
        if (reportedUserId && userData[reportedUserId]) {
            userData[reportedUserId].reportCount++;
            analytics.totalReportsToday++; // Track report
            console.log(`User ${reportedUserId} reported. Total reports: ${userData[reportedUserId].reportCount}`);

            // Block this user for current session
            user.blockedUsers.push(reportedUserId);
        }

        socket.emit('reportConfirmed');
    });

    // Stop matching / disconnect
    socket.on('stopMatching', () => {
        leaveRoom(socket, 'stopped');
        waitingQueue = waitingQueue.filter(s => s.id !== socket.id);
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);

        leaveRoom(socket, 'disconnected');
        waitingQueue = waitingQueue.filter(s => s.id !== socket.id);
        delete userData[socket.id];
    });
});

// ============= SERVER START =============

server.listen(PORT, () => {
    console.log(`🎙️  VoiceLink server running on http://localhost:${PORT}`);
    console.log(`📊 Admin dashboard: http://localhost:${PORT}/admin?key=${ADMIN_PASSWORD}`);
});
