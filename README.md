# 🎙️ VoiceLink

Anonymous voice chat platform - connect with strangers through voice calls.

![VoiceLink Demo](https://img.shields.io/badge/Status-Live-brightgreen)

## Features

- 🎲 **Random Matching** - Instantly connect with strangers
- 🏷️ **Interest Tags** - Match with like-minded people
- ⏱️ **5-Minute Timer** - With mutual extend option
- ⏭️ **Skip** - Instantly find a new partner
- 🔇 **Mute** - Toggle your microphone
- 🚩 **Report & Block** - Basic moderation

## Tech Stack

- **Frontend**: HTML, CSS, JavaScript
- **Backend**: Node.js, Express
- **Real-time**: Socket.io
- **Voice**: WebRTC (peer-to-peer)

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start

# Open http://localhost:3000
```

## How It Works

1. User clicks "Start Talking"
2. Server adds user to matching queue
3. When matched, WebRTC peer connection is established
4. Voice data flows directly between users (P2P)
5. Timer runs for 5 minutes, extendable if both agree

## Deployment

This app is deployed on Railway for always-on hosting.

## License

MIT
