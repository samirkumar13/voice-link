// ============= STATE MANAGEMENT =============

const state = {
    screen: 'landing', // 'landing' | 'waiting' | 'call'
    interests: [],
    roomId: null,
    isMuted: false,
    timerEnd: null,
    timerInterval: null,
    partnerRequestedExtend: false,
    localStream: null,
    peerConnection: null
};

// ============= DOM ELEMENTS =============

const elements = {
    screens: {
        landing: document.getElementById('landing-screen'),
        waiting: document.getElementById('waiting-screen'),
        call: document.getElementById('call-screen')
    },
    interestsInput: document.getElementById('interests-input'),
    interestsTags: document.getElementById('interests-tags'),
    startBtn: document.getElementById('start-btn'),
    cancelBtn: document.getElementById('cancel-btn'),
    timerDisplay: document.getElementById('timer-display'),
    extendBanner: document.getElementById('extend-banner'),
    acceptExtendBtn: document.getElementById('accept-extend-btn'),
    muteBtn: document.getElementById('mute-btn'),
    extendBtn: document.getElementById('extend-btn'),
    skipBtn: document.getElementById('skip-btn'),
    reportBtn: document.getElementById('report-btn'),
    endBtn: document.getElementById('end-btn'),
    reportModal: document.getElementById('report-modal'),
    reportCancelBtn: document.getElementById('report-cancel-btn'),
    reportConfirmBtn: document.getElementById('report-confirm-btn'),
    remoteAudio: document.getElementById('remote-audio'),
    toastContainer: document.getElementById('toast-container')
};

// ============= SOCKET & WEBRTC CONFIG =============

const socket = io();

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

// ============= SCREEN MANAGEMENT =============

function switchScreen(screenName) {
    Object.entries(elements.screens).forEach(([name, el]) => {
        el.classList.toggle('active', name === screenName);
    });
    state.screen = screenName;
}

// ============= INTERESTS MANAGEMENT =============

function addInterest(interest) {
    const cleaned = interest.trim().toLowerCase();
    if (!cleaned || state.interests.includes(cleaned)) return;
    if (state.interests.length >= 5) {
        showToast('Maximum 5 interests allowed', 'error');
        return;
    }

    state.interests.push(cleaned);
    renderInterests();
}

function removeInterest(interest) {
    state.interests = state.interests.filter(i => i !== interest);
    renderInterests();
}

function renderInterests() {
    elements.interestsTags.innerHTML = state.interests.map(interest => `
        <span class="interest-tag">
            ${interest}
            <button onclick="removeInterest('${interest}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        </span>
    `).join('');
}

elements.interestsInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        addInterest(e.target.value);
        e.target.value = '';
    }
});

// ============= TOAST NOTIFICATIONS =============

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============= TIMER =============

function startTimer() {
    if (state.timerInterval) clearInterval(state.timerInterval);

    state.timerInterval = setInterval(() => {
        if (!state.timerEnd) return;

        const remaining = Math.max(0, state.timerEnd - Date.now());
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);

        elements.timerDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        // Visual warnings
        if (remaining <= 30000) {
            elements.timerDisplay.classList.add('critical');
            elements.timerDisplay.classList.remove('warning');
        } else if (remaining <= 60000) {
            elements.timerDisplay.classList.add('warning');
            elements.timerDisplay.classList.remove('critical');
        } else {
            elements.timerDisplay.classList.remove('warning', 'critical');
        }

        // Time's up
        if (remaining <= 0) {
            clearInterval(state.timerInterval);
            showToast('Time\'s up! Finding a new partner...', 'info');
            socket.emit('skip');
        }
    }, 1000);
}

function stopTimer() {
    if (state.timerInterval) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
    }
    elements.timerDisplay.classList.remove('warning', 'critical');
}

// ============= WEBRTC =============

async function getLocalStream() {
    if (state.localStream) return state.localStream;

    try {
        state.localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        });
        return state.localStream;
    } catch (err) {
        console.error('Microphone access error:', err);
        showToast('Please allow microphone access to use VoiceMatch', 'error');
        throw err;
    }
}

async function createPeerConnection(isInitiator) {
    // Cleanup existing connection
    if (state.peerConnection) {
        state.peerConnection.close();
    }

    state.peerConnection = new RTCPeerConnection(rtcConfig);

    // Add local audio track
    const stream = await getLocalStream();
    stream.getAudioTracks().forEach(track => {
        state.peerConnection.addTrack(track, stream);
    });

    // Handle incoming audio
    state.peerConnection.ontrack = (event) => {
        console.log('Received remote track');
        elements.remoteAudio.srcObject = event.streams[0];
    };

    // Handle ICE candidates
    state.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('iceCandidate', {
                roomId: state.roomId,
                candidate: event.candidate
            });
        }
    };

    // Connection state monitoring
    state.peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', state.peerConnection.connectionState);
        if (state.peerConnection.connectionState === 'failed') {
            showToast('Connection failed. Finding new partner...', 'error');
            socket.emit('skip');
        }
    };

    // If initiator, create and send offer
    if (isInitiator) {
        const offer = await state.peerConnection.createOffer();
        await state.peerConnection.setLocalDescription(offer);
        socket.emit('offer', { roomId: state.roomId, offer });
    }
}

function closePeerConnection() {
    if (state.peerConnection) {
        state.peerConnection.close();
        state.peerConnection = null;
    }
    elements.remoteAudio.srcObject = null;
}

// ============= SOCKET EVENT HANDLERS =============

socket.on('waiting', () => {
    console.log('Waiting for match...');
    switchScreen('waiting');
});

socket.on('matched', async (data) => {
    console.log('Matched!', data);
    state.roomId = data.roomId;
    state.timerEnd = data.timerEnd;
    state.partnerRequestedExtend = false;
    elements.extendBanner.classList.remove('visible');

    switchScreen('call');
    startTimer();

    await createPeerConnection(data.isInitiator);
});

socket.on('offer', async (data) => {
    console.log('Received offer');
    if (!state.peerConnection) {
        await createPeerConnection(false);
    }
    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await state.peerConnection.createAnswer();
    await state.peerConnection.setLocalDescription(answer);
    socket.emit('answer', { roomId: state.roomId, answer });
});

socket.on('answer', async (data) => {
    console.log('Received answer');
    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('iceCandidate', async (data) => {
    if (state.peerConnection && data.candidate) {
        try {
            await state.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
            console.error('Error adding ICE candidate:', err);
        }
    }
});

socket.on('partnerLeft', (data) => {
    console.log('Partner left:', data.reason);
    closePeerConnection();
    stopTimer();

    const messages = {
        skipped: 'Partner skipped. Finding someone new...',
        disconnected: 'Partner disconnected. Finding someone new...',
        stopped: 'Partner left. Finding someone new...'
    };

    showToast(messages[data.reason] || 'Partner left', 'info');
    switchScreen('waiting');

    // Request new match automatically
    socket.emit('startMatching', { interests: state.interests });
});

socket.on('partnerRequestedExtend', () => {
    state.partnerRequestedExtend = true;
    elements.extendBanner.classList.add('visible');
    showToast('Partner wants to extend the call!', 'success');
});

socket.on('timerExtended', (data) => {
    state.timerEnd = data.timerEnd;
    state.partnerRequestedExtend = false;
    elements.extendBanner.classList.remove('visible');
    showToast('Call extended by 5 minutes!', 'success');
});

socket.on('reportConfirmed', () => {
    showToast('User reported and blocked', 'success');
    elements.reportModal.classList.remove('visible');
    socket.emit('skip');
});

// ============= BUTTON EVENT HANDLERS =============

elements.startBtn.addEventListener('click', async () => {
    try {
        // Request mic permission first
        await getLocalStream();

        socket.emit('startMatching', { interests: state.interests });
        switchScreen('waiting');
    } catch (err) {
        // Error already shown in getLocalStream
    }
});

elements.cancelBtn.addEventListener('click', () => {
    socket.emit('stopMatching');
    switchScreen('landing');
});

elements.muteBtn.addEventListener('click', () => {
    state.isMuted = !state.isMuted;

    if (state.localStream) {
        state.localStream.getAudioTracks().forEach(track => {
            track.enabled = !state.isMuted;
        });
    }

    elements.muteBtn.classList.toggle('active', state.isMuted);
    elements.muteBtn.querySelector('.icon-unmuted').classList.toggle('hidden', state.isMuted);
    elements.muteBtn.querySelector('.icon-muted').classList.toggle('hidden', !state.isMuted);
});

elements.extendBtn.addEventListener('click', () => {
    socket.emit('requestExtend');
    showToast('Extension request sent to partner', 'info');
});

elements.acceptExtendBtn.addEventListener('click', () => {
    socket.emit('requestExtend');
});

elements.skipBtn.addEventListener('click', () => {
    closePeerConnection();
    stopTimer();
    socket.emit('skip');
    switchScreen('waiting');
});

elements.reportBtn.addEventListener('click', () => {
    elements.reportModal.classList.add('visible');
});

elements.reportCancelBtn.addEventListener('click', () => {
    elements.reportModal.classList.remove('visible');
});

elements.reportConfirmBtn.addEventListener('click', () => {
    socket.emit('report');
});

elements.endBtn.addEventListener('click', () => {
    closePeerConnection();
    stopTimer();
    socket.emit('stopMatching');
    switchScreen('landing');
});

// ============= CLEANUP ON PAGE UNLOAD =============

window.addEventListener('beforeunload', () => {
    closePeerConnection();
    if (state.localStream) {
        state.localStream.getTracks().forEach(track => track.stop());
    }
    socket.emit('stopMatching');
});

// ============= INITIALIZE =============

console.log('🎙️ VoiceLink initialized');
