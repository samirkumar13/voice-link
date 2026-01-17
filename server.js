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

// ============= DATA STORES =============

// Queue for users waiting to be matched
let waitingQueue = [];

// Active rooms: { roomId: { users: [socketId1, socketId2], timerEnd: timestamp, startTime: timestamp } }
let activeRooms = {};

// User data: { socketId: { interests: [], roomId: null, blockedUsers: [], reportCount: 0 } }
let userData = {};

// ============= ANALYTICS =============

const analytics = {
    totalCallsToday: 0,
    totalCallsAllTime: 0,
    totalSkipsToday: 0,
    totalReportsToday: 0,
    totalExtendsToday: 0,
    callDurations: [],
    peakOnlineUsers: 0,
    serverStartTime: Date.now(),
    lastResetDate: new Date().toDateString()
};

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

function getAvgCallDuration() {
    if (analytics.callDurations.length === 0) return 0;
    const sum = analytics.callDurations.reduce((a, b) => a + b, 0);
    return Math.round(sum / analytics.callDurations.length);
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
}

// ============= ADMIN DASHBOARD =============

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
    const skipRate = analytics.totalCallsToday > 0 ? Math.round((analytics.totalSkipsToday / analytics.totalCallsToday) * 100) : 0;
    const extendRate = analytics.totalCallsToday > 0 ? Math.round((analytics.totalExtendsToday / analytics.totalCallsToday) * 100) : 0;

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
            <title>VoiceLink Admin</title>
            <meta http-equiv="refresh" content="10">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Segoe UI', Arial; background: linear-gradient(135deg, #0a0a0f, #1a1a2e); color: #fff; min-height: 100vh; padding: 40px; }
                .header { text-align: center; margin-bottom: 40px; }
                .header h1 { font-size: 2rem; background: linear-gradient(135deg, #6366f1, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
                .header p { color: #888; margin-top: 8px; }
                .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; max-width: 1200px; margin: 0 auto; }
                .card { background: rgba(30, 30, 50, 0.8); border-radius: 16px; padding: 24px; border: 1px solid rgba(255,255,255,0.1); }
                .card-label { font-size: 0.875rem; color: #888; text-transform: uppercase; letter-spacing: 1px; }
                .card-value { font-size: 2.5rem; font-weight: 700; margin-top: 8px; }
                .green { color: #22c55e; } .blue { color: #6366f1; } .orange { color: #f97316; } .red { color: #ef4444; } .purple { color: #a855f7; }
                .section { font-size: 1.25rem; margin: 40px auto 20px; color: #888; max-width: 1200px; }
                .footer { text-align: center; margin-top: 40px; color: #555; font-size: 0.875rem; }
                .live-dot { display: inline-block; width: 10px; height: 10px; background: #22c55e; border-radius: 50%; margin-right: 8px; animation: pulse 1.5s infinite; }
                @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>📊 VoiceLink Admin Dashboard</h1>
                <p><span class="live-dot"></span>Live - Auto-refreshes every 10 seconds</p>
            </div>
            
            <div class="section">🟢 Real-Time Status</div>
            <div class="grid">
                <div class="card"><div class="card-label">Online Users</div><div class="card-value green">${onlineUsers}</div></div>
                <div class="card"><div class="card-label">In Queue</div><div class="card-value blue">${usersInQueue}</div></div>
                <div class="card"><div class="card-label">Active Calls</div><div class="card-value purple">${activeCalls}</div></div>
                <div class="card"><div class="card-label">Peak Users Today</div><div class="card-value orange">${analytics.peakOnlineUsers}</div></div>
            </div>
            
            <div class="section">📈 Today's Stats</div>
            <div class="grid">
                <div class="card"><div class="card-label">Calls Today</div><div class="card-value blue">${analytics.totalCallsToday}</div></div>
                <div class="card"><div class="card-label">Avg Duration</div><div class="card-value green">${formatDuration(getAvgCallDuration())}</div></div>
                <div class="card"><div class="card-label">Skip Rate</div><div class="card-value orange">${skipRate}%</div></div>
                <div class="card"><div class="card-label">Extend Rate</div><div class="card-value purple">${extendRate}%</div></div>
            </div>
            
            <div class="section">🚩 Moderation</div>
            <div class="grid">
                <div class="card"><div class="card-label">Reports Today</div><div class="card-value red">${analytics.totalReportsToday}</div></div>
                <div class="card"><div class="card-label">All-Time Calls</div><div class="card-value blue">${analytics.totalCallsAllTime}</div></div>
                <div class="card"><div class="card-label">Uptime</div><div class="card-value green">${uptimeHours}h ${uptimeMins}m</div></div>
            </div>
            
            <div class="footer">VoiceLink Admin • Updated: ${new Date().toLocaleTimeString()}</div>
        </body>
        </html>
    `);
});

// ============= MATCHING FUNCTIONS =============

function generateRoomId() {
    return 'room_' + Math.random().toString(36).substring(2, 15);
}

function getInterestScore(interests1, interests2) {
    if (!interests1.length || !interests2.length) return 0;
    const set1 = new Set(interests1.map(i => i.toLowerCase()));
    let matches = 0;
    for (const interest of interests2) {
        if (set1.has(interest.toLowerCase())) matches++;
    }
    return matches;
}

function findMatch(socket) {
    const user = userData[socket.id];
    if (!user) return null;

    const availableUsers = waitingQueue.filter(s => {
        const otherUser = userData[s.id];
        if (!otherUser) return false;
        if (s.id === socket.id) return false;
        if (user.blockedUsers.includes(s.id)) return false;
        if (otherUser.blockedUsers.includes(socket.id)) return false;
        return true;
    });

    if (availableUsers.length === 0) return null;

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
        return bestMatch;
    }

    return availableUsers[0];
}

function createRoom(socket1, socket2) {
    const roomId = generateRoomId();

    waitingQueue = waitingQueue.filter(s => s.id !== socket1.id && s.id !== socket2.id);

    activeRooms[roomId] = {
        users: [socket1.id, socket2.id],
        timerEnd: Date.now() + 5 * 60 * 1000,
        extendRequests: new Set(),
        startTime: Date.now()
    };

    // Analytics
    analytics.totalCallsToday++;
    analytics.totalCallsAllTime++;

    userData[socket1.id].roomId = roomId;
    userData[socket2.id].roomId = roomId;

    socket1.join(roomId);
    socket2.join(roomId);

    socket1.emit('matched', { roomId, isInitiator: true, timerEnd: activeRooms[roomId].timerEnd });
    socket2.emit('matched', { roomId, isInitiator: false, timerEnd: activeRooms[roomId].timerEnd });

    console.log(`Room created: ${roomId}`);
}

function leaveRoom(socket, reason = 'left') {
    const user = userData[socket.id];
    if (!user || !user.roomId) return;

    const roomId = user.roomId;
    const room = activeRooms[roomId];

    if (room) {
        // Track duration
        if (room.startTime) {
            const duration = Math.floor((Date.now() - room.startTime) / 1000);
            analytics.callDurations.push(duration);
            if (analytics.callDurations.length > 100) analytics.callDurations.shift();
        }

        socket.to(roomId).emit('partnerLeft', { reason });

        const otherUserId = room.users.find(id => id !== socket.id);
        if (otherUserId && userData[otherUserId]) {
            userData[otherUserId].roomId = null;
        }

        delete activeRooms[roomId];
    }

    socket.leave(roomId);
    user.roomId = null;
}

// ============= SOCKET HANDLERS =============

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    userData[socket.id] = {
        interests: [],
        roomId: null,
        blockedUsers: [],
        reportCount: 0
    };

    socket.on('startMatching', (data) => {
        const { interests = [] } = data || {};
        userData[socket.id].interests = interests;

        if (!waitingQueue.find(s => s.id === socket.id)) {
            waitingQueue.push(socket);
        }

        const match = findMatch(socket);
        if (match) {
            createRoom(socket, match);
        } else {
            socket.emit('waiting');
        }
    });

    socket.on('offer', (data) => {
        socket.to(data.roomId).emit('offer', { offer: data.offer });
    });

    socket.on('answer', (data) => {
        socket.to(data.roomId).emit('answer', { answer: data.answer });
    });

    socket.on('iceCandidate', (data) => {
        socket.to(data.roomId).emit('iceCandidate', { candidate: data.candidate });
    });

    socket.on('skip', () => {
        leaveRoom(socket, 'skipped');
        analytics.totalSkipsToday++;

        if (!waitingQueue.find(s => s.id === socket.id)) {
            waitingQueue.push(socket);
        }

        const match = findMatch(socket);
        if (match) {
            createRoom(socket, match);
        } else {
            socket.emit('waiting');
        }
    });

    socket.on('requestExtend', () => {
        const user = userData[socket.id];
        if (!user || !user.roomId) return;

        const room = activeRooms[user.roomId];
        if (!room) return;

        room.extendRequests.add(socket.id);

        if (room.extendRequests.size >= 2) {
            room.timerEnd += 5 * 60 * 1000;
            room.extendRequests.clear();
            analytics.totalExtendsToday++;
            io.to(user.roomId).emit('timerExtended', { timerEnd: room.timerEnd });
        } else {
            socket.to(user.roomId).emit('partnerRequestedExtend');
        }
    });

    socket.on('report', () => {
        const user = userData[socket.id];
        if (!user || !user.roomId) return;

        const room = activeRooms[user.roomId];
        if (!room) return;

        const reportedUserId = room.users.find(id => id !== socket.id);
        if (reportedUserId && userData[reportedUserId]) {
            userData[reportedUserId].reportCount++;
            analytics.totalReportsToday++;
            user.blockedUsers.push(reportedUserId);
        }

        socket.emit('reportConfirmed');
    });

    socket.on('stopMatching', () => {
        leaveRoom(socket, 'stopped');
        waitingQueue = waitingQueue.filter(s => s.id !== socket.id);
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        leaveRoom(socket, 'disconnected');
        waitingQueue = waitingQueue.filter(s => s.id !== socket.id);
        delete userData[socket.id];
    });
});

// ============= SERVER START =============

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🎙️  VoiceLink running on port ${PORT}`);
    console.log(`📊 Admin dashboard: /admin`);
});
