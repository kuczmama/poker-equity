// Hand Analysis Logic

// Predefined position ranges (copied from range-equity-app.js)
const POSITION_RANGES = {
    'UTG': 'A4s+,K9s+,QTs+,77+,AJo+,JTs',
    'UTG+1': 'A3s+,K9s+,QTs+,77+,AJo+,JTs',
    'UTG+2': 'A3s+,K5s+,Q9s+,77+,ATo+,JTs,T9s,KJo+',
    'LJ': 'A2s+,K5s+,Q9s+,J9s+,66+,T9s,ATo+',
    'HJ': 'A2s+,K5s+,Q8s+,J9s+,55+,T9s,A9o+,T8s',
    'CO': 'A5o,A8o+,KTo+,QTo+,JTo+,A2s+,K2s+,Q5s+,J7s+,T8s+,44+,87s,97s,98s',
    'BTN': 'A3o+,A8o+,K8o+,QTo+,JTo+,A2s+,K2s+,Q5s+,J7s+,T8s+,22+,87s,97s,98s,54s,65s,75s,96s+,T8o',
    'SB': 'A3o+,A8o+,K8o+,QTo+,JTo+,A2s+,K2s+,Q5s+,J7s+,T8s+,22+,87s,97s,98s,54s,65s,75s,96s+',
    'BB': '22+,A2+,K2+,Q2+,J2+,T2+,92+,82+,72+,62+,52+,42+,32+,A2s+,K2s+,Q2s+,J2s+,T2s+,92s+,82s+,72s+,62s+,52s+,42s+,32s+'
};

class HandHistoryParser {
    constructor(text) {
        this.text = text;
        this.lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        this.hero = null;
        this.hand = null;
        this.board = [];
        this.actions = [];
        this.blinds = { sb: 0, bb: 0, ante: 0 };
        this.seats = {};
        this.buttonSeat = 0;
        this.potSize = 0;
    }

    parse() {
        try {
            this.parseHeader();
            this.parseSeats();
            this.parseBlinds(); // And antes
            this.parseActions();
            return {
                hero: this.hero,
                hand: this.hand,
                board: this.board,
                actions: this.actions,
                blinds: this.blinds,
                seats: this.seats
            };
        } catch (e) {
            console.error("Parsing error", e);
            throw new Error("Failed to parse hand history: " + e.message);
        }
    }

    parseHeader() {
        // Line 1: CoinPoker Hand #350747173: Hold'em No Limit (0.05/0.1 ante 0.01) ...
        const headerLine = this.lines[0];
        const blindMatch = headerLine.match(/\(([\d\.]+)\/([\d\.]+)(?: ante ([\d\.]+))?\)/);
        if (blindMatch) {
            this.blinds.sb = parseFloat(blindMatch[1]);
            this.blinds.bb = parseFloat(blindMatch[2]);
            this.blinds.ante = blindMatch[3] ? parseFloat(blindMatch[3]) : 0;
        }

        // Line 2: Table 'NL ₮10 I' 7-max Seat #1 is the button
        const buttonLine = this.lines.find(l => l.includes('Seat #') && l.includes('is the button'));
        if (buttonLine) {
            const match = buttonLine.match(/Seat #(\d+) is the button/);
            if (match) this.buttonSeat = parseInt(match[1]);
        }
    }

    parseSeats() {
        // Seat 1: liliroro (10.9 in chips)
        for (const line of this.lines) {
            const match = line.match(/Seat (\d+): (.+) \(([\d\.]+) in chips\)/);
            if (match) {
                this.seats[match[1]] = {
                    name: match[2],
                    stack: parseFloat(match[3]),
                    seat: parseInt(match[1])
                };
            }
        }
    }

    parseBlinds() {
        // Already parsed values, but could parse posts here if needed for exact stack tracking
    }

    parseActions() {
        let currentStreet = 'PREFLOP';
        let streetActions = [];
        
        for (let i = 0; i < this.lines.length; i++) {
            const line = this.lines[i];

            if (line.includes('*** HOLE CARDS ***')) {
                currentStreet = 'PREFLOP';
                // Next line usually: Dealt to Hero [Ah Kh]
                const dealtLine = this.lines[i+1];
                if (dealtLine && dealtLine.startsWith('Dealt to')) {
                    const match = dealtLine.match(/Dealt to (.+) \[(.+)\]/);
                    if (match) {
                        this.hero = match[1];
                        this.hand = match[2].replace(/\s/g, ''); // Remove spaces from "Ad Qs" -> "AdQs"
                        // Normalize hand format if needed
                        this.hand = this.hand.replace(/([AKQJT2-9])([shdc])/g, '$1$2'); 
                    }
                }
                continue;
            }

            if (line.includes('*** FLOP ***')) {
                this.pushStreetActions(currentStreet, streetActions);
                currentStreet = 'FLOP';
                streetActions = [];
                const match = line.match(/\[(.*)\]/);
                if (match) this.board = this.parseCards(match[1]);
                continue;
            }

            if (line.includes('*** TURN ***')) {
                this.pushStreetActions(currentStreet, streetActions);
                currentStreet = 'TURN';
                streetActions = [];
                // Format: *** TURN *** [Jh As Ks] [5h]
                const match = line.match(/\] \[(.*)\]/); // Get the single card in second bracket
                if (match) this.board.push(...this.parseCards(match[1]));
                continue;
            }

            if (line.includes('*** RIVER ***')) {
                this.pushStreetActions(currentStreet, streetActions);
                currentStreet = 'RIVER';
                streetActions = [];
                const match = line.match(/\] \[(.*)\]/);
                if (match) this.board.push(...this.parseCards(match[1]));
                continue;
            }

            if (line.includes('*** SHOW DOWN ***') || line.includes('*** SUMMARY ***')) {
                this.pushStreetActions(currentStreet, streetActions);
                break;
            }

            // Parse individual actions
            // kucz: raises 0.2 to 0.3
            // liliroro: calls 1.6
            // kucz: bets 3
            // Kanu: folds
            if (line.includes(':')) {
                const parts = line.split(':');
                const name = parts[0].trim();
                const actionPart = parts[1].trim();
                
                // Skip posts, chat, etc.
                if (actionPart.startsWith('posts')) continue;

                let type = 'unknown';
                let amount = 0;

                if (actionPart.startsWith('folds')) type = 'fold';
                else if (actionPart.startsWith('checks')) type = 'check';
                else if (actionPart.startsWith('calls')) {
                    type = 'call';
                    const amt = actionPart.match(/calls ([\d\.]+)/);
                    if (amt) amount = parseFloat(amt[1]);
                }
                else if (actionPart.startsWith('bets')) {
                    type = 'bet';
                    const amt = actionPart.match(/bets ([\d\.]+)/);
                    if (amt) amount = parseFloat(amt[1]);
                }
                else if (actionPart.startsWith('raises')) {
                    type = 'raise';
                    // raises 0.2 to 0.3 -> amount is usually the 'to' part or the diff? 
                    // Usually "raises X to Y", Y is the total wager this street (or total bet?)
                    // For analysis, we usually care about the total amount put in.
                    const amt = actionPart.match(/raises .* to ([\d\.]+)/);
                    if (amt) amount = parseFloat(amt[1]);
                }

                if (type !== 'unknown') {
                    streetActions.push({
                        player: name,
                        type: type,
                        amount: amount
                    });
                }
            }
        }
    }

    pushStreetActions(street, actions) {
        if (actions.length > 0) {
            this.actions.push({
                street: street,
                actions: actions
            });
        }
    }

    parseCards(str) {
        // [Jh As Ks] -> ["Jh", "As", "Ks"]
        return str.trim().split(/\s+/).map(c => c.trim());
    }
}

class HandAnalyzer {
    constructor(parsedHand) {
        this.data = parsedHand;
        this.hero = parsedHand.hero;
        this.results = [];
        this.currentPot = 0;
        // Basic pot calculation (sum of blinds + antes + actions)
        this.calculateInitialPot();
    }

    calculateInitialPot() {
        const blinds = this.data.blinds;
        // Small Blind + Big Blind
        this.currentPot = blinds.sb + blinds.bb;
        // Antes * number of players (based on seats)
        const playerCount = Object.keys(this.data.seats).length;
        this.currentPot += (blinds.ante * playerCount);
    }

    async analyze() {
        // Filter actions to only show Hero's actions
        const heroActions = [];
        
        let boardSoFar = [];
        
        // Track pot size through actions
        let currentStreetPot = this.currentPot;
        let streetBets = {}; // Map player -> amount bet this street

        for (const streetBlock of this.data.actions) {
            const street = streetBlock.street;
            
            // Update board based on street
            if (street === 'FLOP') boardSoFar = this.data.board.slice(0, 3);
            if (street === 'TURN') boardSoFar = this.data.board.slice(0, 4);
            if (street === 'RIVER') boardSoFar = this.data.board.slice(0, 5);

            // Reset street bets
            streetBets = {};
            
            for (const action of streetBlock.actions) {
                const isHero = action.player === this.hero;
                
                // Track contribution
                const prevBet = streetBets[action.player] || 0;
                let addedToPot = 0;
                
                if (action.type === 'call' || action.type === 'bet' || action.type === 'raise') {
                    // In most HH, amount is the total wager for the street? 
                    // Or "bets 3" means adds 3? 
                    // "calls 1.6" usually means matches to 1.6.
                    // CoinPoker: "raises 0.2 to 0.3" -> total 0.3.
                    // "bets 3" -> total 3.
                    // "calls 3" -> total 3.
                    
                    const amount = action.amount;
                    addedToPot = amount - prevBet;
                    streetBets[action.player] = amount;
                    currentStreetPot += addedToPot;
                }

                if (isHero) {
                    const context = {
                        street: street,
                        action: action,
                        potSize: currentStreetPot - addedToPot, // Pot before this action
                        board: [...boardSoFar], // Copy
                        heroHand: this.data.hand
                    };

                    const analysis = await this.evaluateAction(context);
                    this.results.push(analysis);
                }
            }
        }
        
        return this.results;
    }

    async evaluateAction(context) {
        const { street, action, potSize, board, heroHand } = context;
        let rating = "Neutral";
        let comment = "";
        let evData = null;

        // 1. Preflop Logic
        if (street === 'PREFLOP') {
            // Check position ranges logic if it's the first action (Open)
            // Or simple premium check
            // TODO: infer position from seats/button
            if (action.type === 'raise' || action.type === 'bet') {
                 // Simple heuristic
                 rating = "Good";
                 comment = "Aggressive preflop play is generally good.";
            } else if (action.type === 'call') {
                 rating = "Okay";
                 comment = "Calling preflop can be passive, ensure you have odds.";
            } else if (action.type === 'fold') {
                 rating = "Neutral";
                 comment = "Folded.";
            }
        } 
        // 2. Postflop Logic
        else {
            // Calculate Equity
            const equityResult = await this.calculateEquity(heroHand, board);
            const equity = equityResult.range1Equity;
            
            comment = `Equity: ${equity.toFixed(1)}%`;

            if (action.type === 'bet' || action.type === 'raise') {
                // Check bet sizing efficiency
                // Call simulated EV calc
                const evRes = await this.simulateEV(potSize, board, heroHand, action.amount);
                evData = evRes;
                
                if (equity > 60) {
                    rating = "Good";
                    comment += ". Strong hand value bet.";
                } else if (equity < 30) {
                    rating = "Bold";
                    comment += ". Bluffing with low equity?";
                } else {
                    rating = "Okay";
                }
            } else if (action.type === 'call') {
                // Pot odds check
                // Need to know the bet facing amount. 
                // Hard to track perfectly without full state machine, assuming previous action set the price
                rating = "Okay";
            } else if (action.type === 'check') {
                if (equity > 80) {
                    rating = "Questionable";
                    comment += ". Slow playing strong hand?";
                } else {
                    rating = "Standard";
                }
            }
        }

        return {
            street,
            action: action.type,
            amount: action.amount,
            potSize,
            board: board.join(' '),
            rating,
            comment,
            evData
        };
    }

    async calculateEquity(hand, board) {
        // Use random range for Villain for now (e.g., top 50%)
        // Or "Any Two"
        const villainRange = "22+,A2s+,K2s+,Q2s+,J2s+,T2s+,95s+,85s+,75s+,65s+,54s,A2o+,K5o+,Q7o+,J8o+,T8o+"; 
        // Using OddsCalculator from poker-logic.js
        // Need to format board string
        const boardStr = board.join(' ');
        
        try {
            // Use BetSizingApp helper method if I could, but I'll use OddsCalculator directly
            // Need to handle async simulation
            return await new Promise(resolve => {
                setTimeout(() => {
                    const res = OddsCalculator.calculateRangeEquity(hand, villainRange, boardStr, 2000);
                    resolve(res);
                }, 0);
            });
        } catch (e) {
            console.error("Equity calc error", e);
            return { range1Equity: 50 }; // Fallback
        }
    }

    async simulateEV(potSize, board, hand, amount) {
        // Reuse logic concept from BetSizingApp
        // Villain Range
        const villainRange = "22+,A2s+,K2s+,Q2s+,J2s+,T2s+,95s+,85s+,75s+,65s+,54s,A2o+,K5o+,Q7o+,J8o+,T8o+";
        
        // Calculate EV for the chosen amount
        // EV = (Fold% * Pot) + (Call% * (Equity * (Pot + 2*Bet) - Bet))
        
        // Assume standard elastic defense
        const betPct = amount / potSize;
        const mdf = 1 / (1 + betPct);
        const defenseFreq = mdf * 0.9;
        const foldPct = 1 - defenseFreq;
        
        const boardStr = board.join(' ');
        const eqRes = await this.calculateEquity(hand, board);
        const equity = eqRes.range1Equity / 100;
        
        // Adjust equity when called (Villain has stronger range)
        const realizedEquity = Math.max(0, equity - (foldPct * 0.3)); 
        
        const whenCalledEV = (realizedEquity * (potSize + amount * 2)) - amount;
        const ev = (foldPct * potSize) + (defenseFreq * whenCalledEV);
        
        return {
            ev: ev,
            equity: equity * 100,
            foldPct: foldPct * 100
        };
    }
}

class HandAnalysisApp {
    constructor() {
        this.input = document.getElementById('handHistory');
        this.analyzeBtn = document.getElementById('analyzeBtn');
        this.resultsPanel = document.getElementById('resultsPanel');
        this.container = document.getElementById('analysisContainer');
        this.summary = document.getElementById('handSummary');
        
        this.analyzeBtn.addEventListener('click', () => this.runAnalysis());
    }

    async runAnalysis() {
        const text = this.input.value.trim();
        if (!text) {
            alert('Please paste a hand history');
            return;
        }

        this.analyzeBtn.textContent = 'Analyzing...';
        this.analyzeBtn.disabled = true;

        try {
            const parser = new HandHistoryParser(text);
            const parsed = parser.parse();
            
            if (!parsed.hero) {
                // Try to find hero from input if not found (e.g. if HH doesn't say "Dealt to")
                // For now, require it or just use first player with hole cards
                // The parser looks for "Dealt to X [cards]"
                throw new Error("Could not identify Hero (player with hole cards). Ensure 'Dealt to Player [XX XX]' is in the history.");
            }

            const analyzer = new HandAnalyzer(parsed);
            const results = await analyzer.analyze();
            
            this.displayResults(parsed, results);

        } catch (e) {
            console.error(e);
            alert('Error: ' + e.message);
        } finally {
            this.analyzeBtn.textContent = 'Analyze Hand';
            this.analyzeBtn.disabled = false;
        }
    }

    displayResults(parsed, results) {
        this.resultsPanel.style.display = 'block';
        this.container.innerHTML = '';
        
        // Summary
        this.summary.innerHTML = `
            <p><strong>Hero:</strong> ${parsed.hero}</p>
            <p><strong>Hand:</strong> ${parsed.hand}</p>
            <p><strong>Board:</strong> ${parsed.board.join(' ') || 'None'}</p>
            <p><strong>Blinds:</strong> ${parsed.blinds.sb}/${parsed.blinds.bb}</p>
        `;

        // Render each action
        results.forEach(res => {
            const el = document.createElement('div');
            el.className = 'bg-white dark:bg-gray-800 p-4 rounded border border-gray-200 dark:border-gray-700 analysis-card';
            
            let ratingClass = 'text-gray-500';
            if (res.rating === 'Good') ratingClass = 'action-rating-good font-bold';
            if (res.rating === 'Questionable') ratingClass = 'action-rating-ok font-bold';
            if (res.rating === 'Bold') ratingClass = 'action-rating-ok font-bold';

            let evInfo = '';
            if (res.evData) {
                evInfo = `
                    <div class="mt-2 text-xs text-gray-500 dark:text-gray-400 grid grid-cols-3 gap-2 bg-gray-50 dark:bg-gray-900/50 p-2 rounded">
                        <div>EV: <span class="${res.evData.ev >= 0 ? 'text-green-500' : 'text-red-500'}">$${res.evData.ev.toFixed(2)}</span></div>
                        <div>Eq: ${res.evData.equity.toFixed(1)}%</div>
                        <div>Fold%: ${res.evData.foldPct.toFixed(0)}%</div>
                    </div>
                `;
            }

            el.innerHTML = `
                <div class="flex justify-between items-start mb-2">
                    <span class="text-xs font-bold uppercase tracking-wide text-gray-400">${res.street}</span>
                    <span class="${ratingClass} text-sm">${res.rating}</span>
                </div>
                <div class="flex items-center gap-2 mb-2">
                    <span class="text-lg font-bold text-gray-900 dark:text-white capitalize">${res.action}</span>
                    ${res.amount ? `<span class="text-gray-600 dark:text-gray-300">$${res.amount}</span>` : ''}
                </div>
                <div class="text-sm text-gray-600 dark:text-gray-400 mb-2">
                    Pot: $${res.potSize.toFixed(2)} ${res.board ? `| Board: ${res.board}` : ''}
                </div>
                <p class="text-sm italic text-gray-500 dark:text-gray-400 border-l-2 border-primary pl-2">
                    "${res.comment}"
                </p>
                ${evInfo}
            `;
            
            this.container.appendChild(el);
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new HandAnalysisApp();
});

