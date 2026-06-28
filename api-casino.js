const express = require('express');
const path = require('path');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const app = express();
const PORT = process.env.PORT || 3004;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

const MONGO_URI = 'mongodb+srv://richvybs18:Fuckyou2026%24@cluster0.cq4ddne.mongodb.net/?appName=Cluster0';
const DB_NAME = 'casino';
let db;

async function connectDB() {
    try {
        const client = new MongoClient(MONGO_URI);
        await client.connect();
        db = client.db(DB_NAME);
        console.log('✅ MongoDB Connected - Casino API');
    } catch (e) { console.error('MongoDB error:', e.message); }
}
connectDB();

function historyCol() { return db?.collection('history'); }
function revenueCol() { return db?.collection('revenue'); }

// ======================== REALISTIC SLOTS ENGINE ========================
const SYMBOLS = ['🍒', '🍋', '🍊', '🍇', '🔔', '⭐', '💎'];
const WEIGHTS = [30, 25, 20, 12, 8, 4, 1]; // Weighted probability

function weightedRandom() {
    const total = WEIGHTS.reduce((a, b) => a + b, 0);
    let random = Math.random() * total;
    for (let i = 0; i < SYMBOLS.length; i++) {
        random -= WEIGHTS[i];
        if (random <= 0) return SYMBOLS[i];
    }
    return SYMBOLS[0];
}

function spinReels() {
    return [weightedRandom(), weightedRandom(), weightedRandom()];
}

function getPayout(reels) {
    const [r1, r2, r3] = reels;
    if (r1 === r2 && r2 === r3) {
        const payouts = { '🍒': 3, '🍋': 5, '🍊': 8, '🍇': 10, '🔔': 15, '⭐': 25, '💎': 100 };
        return payouts[r1] || 1;
    }
    if (r1 === r2 || r2 === r3 || r1 === r3) return 1.5;
    return 0;
}

function getVisualReels(finalReels) {
    // Simulate spinning animation with multiple frames
    const frames = [];
    for (let i = 0; i < 5; i++) {
        frames.push([weightedRandom(), weightedRandom(), weightedRandom()]);
    }
    frames.push(finalReels); // Final result
    return frames;
}

// ======================== GAME STATE ========================
let currentSpin = null;
let spinTimer = null;
let gameLoopInterval = null;

function startCountdown() {
    currentSpin = {
        id: 'SPIN' + Date.now().toString(36).toUpperCase(),
        status: 'countdown',
        countdownStart: Date.now(),
        countdownDuration: 25000, // 25 seconds
        players: {},
        reels: null,
        payout: null,
        frames: null,
        settled: false,
        createdAt: Date.now()
    };
    console.log('🎰 New countdown started:', currentSpin.id);
}

function processSpin() {
    if (!currentSpin || currentSpin.status !== 'countdown') return;
    
    currentSpin.status = 'spinning';
    const reels = spinReels();
    currentSpin.reels = reels;
    currentSpin.payout = getPayout(reels);
    currentSpin.frames = getVisualReels(reels);
    currentSpin.spunAt = Date.now();
    
    console.log('🎰 Spin result:', reels.join(' '), 'Payout:', currentSpin.payout);
    
    // Settle after 5 seconds display
    setTimeout(async () => {
        if (!currentSpin) return;
        currentSpin.settled = true;
        
        // Save to history
        const col = historyCol();
        if (col) {
            await col.insertOne({
                id: currentSpin.id,
                reels: currentSpin.reels,
                payout: currentSpin.payout,
                players: currentSpin.players,
                totalPool: Object.values(currentSpin.players).reduce((s, p) => s + p.bet, 0),
                time: Date.now()
            });
        }
        
        // Update revenue
        const revCol = revenueCol();
        if (revCol) {
            let wagered = 0, paid = 0;
            for (const p of Object.values(currentSpin.players)) {
                wagered += p.bet;
                if (currentSpin.payout > 0) paid += Math.floor(p.bet * currentSpin.payout);
            }
            const rev = await revCol.findOne({ type: 'casino' }) || { total: 0, wagered: 0, paid: 0, spins: 0 };
            rev.total = (rev.total || 0) + (wagered - paid);
            rev.wagered = (rev.wagered || 0) + wagered;
            rev.paid = (rev.paid || 0) + paid;
            rev.spins = (rev.spins || 0) + 1;
            await revCol.updateOne({ type: 'casino' }, { $set: rev }, { upsert: true });
        }
        
        // Start new countdown after 3 seconds
        setTimeout(() => {
            startCountdown();
        }, 3000);
    }, 5000);
}

function runGameLoop() {
    if (gameLoopInterval) clearInterval(gameLoopInterval);
    
    gameLoopInterval = setInterval(() => {
        if (!currentSpin) {
            startCountdown();
            return;
        }
        
        const now = Date.now();
        
        // Countdown → Spin
        if (currentSpin.status === 'countdown') {
            const elapsed = now - currentSpin.countdownStart;
            if (elapsed >= currentSpin.countdownDuration) {
                processSpin();
            }
        }
    }, 500); // Check every 500ms for accuracy
}

startCountdown();
runGameLoop();

// ======================== ENDPOINTS ========================
app.get('/casino/current', (req, res) => {
    if (!currentSpin) startCountdown();
    
    const now = Date.now();
    let timeLeft = 0;
    
    if (currentSpin.status === 'countdown') {
        const elapsed = now - currentSpin.countdownStart;
        timeLeft = Math.max(0, Math.ceil((currentSpin.countdownDuration - elapsed) / 1000));
    }
    
    res.json({
        success: true,
        spin: {
            id: currentSpin.id,
            status: currentSpin.status,
            timeLeft,
            players: currentSpin.players,
            playerCount: Object.keys(currentSpin.players).length,
            totalPool: Object.values(currentSpin.players).reduce((s, p) => s + p.bet, 0),
            reels: currentSpin.reels,
            payout: currentSpin.payout,
            frames: currentSpin.frames,
            settled: currentSpin.settled,
            spunAt: currentSpin.spunAt
        }
    });
});

app.post('/casino/join', (req, res) => {
    if (!currentSpin || currentSpin.status !== 'countdown') {
        return res.json({ success: false, message: 'Cannot join now - spin in progress' });
    }
    
    const now = Date.now();
    const elapsed = now - currentSpin.countdownStart;
    if (elapsed >= currentSpin.countdownDuration - 5000) {
        return res.json({ success: false, message: 'Too late - joining locked' });
    }
    
    const { playerId, playerName, bet } = req.body;
    if (!playerId || !bet) return res.json({ success: false, message: 'Missing data' });
    if (currentSpin.players[playerId]) return res.json({ success: false, message: 'Already joined this spin' });
    
    currentSpin.players[playerId] = {
        id: playerId,
        name: playerName || 'Player',
        bet: Number(bet),
        joinedAt: Date.now()
    };
    
    res.json({ success: true, message: 'Joined!' });
});

app.get('/casino/history', async (req, res) => {
    try {
        const col = historyCol();
        if (!col) return res.json({ success: true, history: [] });
        const history = await col.find({}).sort({ time: -1 }).limit(10).toArray();
        history.forEach(h => delete h._id);
        res.json({ success: true, history });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/casino/revenue', async (req, res) => {
    try {
        const col = revenueCol();
        if (!col) return res.json({ success: true, revenue: { total: 0 } });
        const rev = await col.findOne({ type: 'casino' }) || { total: 0, wagered: 0, paid: 0, spins: 0 };
        delete rev._id;
        res.json({ success: true, revenue: rev });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'casino-api', db: !!db, timestamp: Date.now() });
});

app.listen(PORT, () => console.log(`🎰 Casino API running on port ${PORT}`));
