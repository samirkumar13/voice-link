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

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ============= MATCHING SYSTEM =============

// Queue for users waiting to be matched
let waitingQueue = [];

// Active rooms: { roomId: { users: [socketId1, socketId2], timerEnd: timestamp } }
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

    // Setup room
    activeRooms[roomId] = {
        users: [socket1.id, socket2.id],
        timerEnd: Date.now() + 5 * 60 * 1000, // 5 minutes
        extendRequests: new Set()
    };

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
});
