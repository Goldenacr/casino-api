const express = require('express');
const path = require('path');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const app = express();
const PORT = process.env.PORT || 3004;

app.use(cors());
app.use(express.json());

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

function spinsCol() { return db?.collection('spins'); }
function historyCol() { return db?.collection('history'); }
function revenueCol() { return db?.collection('revenue'); }

// ======================== SLOTS ENGINE ========================
const SYMBOLS = ['🍒', '🍋', '🍊', '🍇', '🔔', '⭐', '💎'];
const PAYOUTS = {
    '🍒': 3, '🍋': 5, '🍊': 8, '🍇': 10, '🔔': 15, '⭐': 25, '💎': 100
};

function spinReels() {
    const r1 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
    const r2 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
    const r3 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
    return [r1, r2, r3];
}

function getPayout(reels) {
    const [r1, r2, r3] = reels;
    // 3 matching
    if (r1 === r2 && r2 === r3) return PAYOUTS[r1] || 1;
    // 2 matching
    if (r1 === r2 || r2 === r3 || r1 === r3) return 1.5;
    // No match
    return 0;
}

// ======================== GAME STATE ========================
let currentSpin = null;
let spinInterval = null;

function startNewRound() {
    currentSpin = {
        id: 'SPIN' + Date.now().toString(36).toUpperCase(),
        status: 'countdown',
        countdownEnd: Date.now() + 30000,
        players: {},
        reels: null,
        result: null
    };
}

function runGameLoop() {
    if (spinInterval) clearInterval(spinInterval);
    
    spinInterval = setInterval(async () => {
        if (!currentSpin) {
            startNewRound();
            return;
        }

        const now = Date.now();

        // COUNTDOWN → SPIN
        if (currentSpin.status === 'countdown' && now >= currentSpin.countdownEnd) {
            currentSpin.status = 'spinning';
            currentSpin.reels = spinReels();
            currentSpin.result = getPayout(currentSpin.reels);
            
            // Save to history
            const players = { ...currentSpin.players };
            const record = {
                id: currentSpin.id,
                reels: currentSpin.reels,
                result: currentSpin.result,
                players,
                time: now
            };
            const col = historyCol();
            if (col) await col.insertOne(record);

            // Update revenue
            let totalWagered = 0, totalPaid = 0;
            for (const p of Object.values(players)) {
                totalWagered += p.bet;
                if (currentSpin.result > 0) {
                    const winAmount = Math.floor(p.bet * currentSpin.result);
                    totalPaid += winAmount;
                }
            }
            const revCol = revenueCol();
            if (revCol) {
                const rev = await revCol.findOne({ type: 'casino' }) || { total: 0, totalWagered: 0, totalPaid: 0 };
                rev.total = (rev.total || 0) + (totalWagered - totalPaid);
                rev.totalWagered = (rev.totalWagered || 0) + totalWagered;
                rev.totalPaid = (rev.totalPaid || 0) + totalPaid;
                await revCol.updateOne({ type: 'casino' }, { $set: rev }, { upsert: true });
            }

            // Start new round after 5 seconds
            setTimeout(() => {
                startNewRound();
            }, 5000);
        }
    }, 1000);
}

startNewRound();
runGameLoop();

// ======================== ENDPOINTS ========================
app.get('/casino/current', (req, res) => {
    if (!currentSpin) startNewRound();
    res.json({ success: true, spin: currentSpin });
});

app.post('/casino/join', (req, res) => {
    if (!currentSpin || currentSpin.status !== 'countdown') {
        return res.json({ success: false, message: 'Cannot join now' });
    }
    const { playerId, playerName, bet } = req.body;
    if (!playerId || !bet) return res.json({ success: false });
    if (currentSpin.players[playerId]) return res.json({ success: false, message: 'Already joined' });

    currentSpin.players[playerId] = { id: playerId, name: playerName || 'Player', bet: Number(bet) };
    res.json({ success: true });
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
        const rev = await col.findOne({ type: 'casino' }) || { total: 0, totalWagered: 0, totalPaid: 0 };
        delete rev._id;
        res.json({ success: true, revenue: rev });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'casino-api', db: !!db, timestamp: Date.now() });
});

app.listen(PORT, () => console.log(`🎰 Casino API running on port ${PORT}`));
