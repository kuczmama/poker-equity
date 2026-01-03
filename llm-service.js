/**
 * LLM Service
 * Handles communication with OpenRouter API
 */
class LLMService {
    constructor() {
        this.apiKey = localStorage.getItem('openrouter_api_key') || '';
        this.baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
        this.model = localStorage.getItem('openrouter_model') || 'google/gemini-2.0-pro-exp-02-05:free';
        
        this.FUNDAMENTALS = `
### **The "CoinPoker" Color Coding System**
You must strictly adhere to this color-coding system when categorizing players. Do not use other colors.

1.  **RED (Danger / Aggressive Reg):**
    *   **Criteria:** High 3-Bet (>8%), High Aggression, Solid VPIP/PFR gap (e.g., 22/18).
    *   **Meaning:** Capable of bluffing, 3-betting light, and applying pressure.
    *   **Examples:** LAGs, Sharks, Maniacs.

2.  **ORANGE (Nit / Tight Reg):**
    *   **Criteria:** Low VPIP (<20%), Low 3-Bet (<4%), High WSD (>60%).
    *   **Meaning:** Plays "Fit or Fold." Only puts money in with the nuts.
    *   **Examples:** Nits, Rocks, Nut-Peddlers.

3.  **GREEN (Fish / Whale):**
    *   **Criteria:** High VPIP with Low PFR (e.g., 40/10), Large Gap (>15%), Limps often, Low WSD (<45% = Spewy) or High WSD (>65% = Station).
    *   **Meaning:** The target. Calling Stations, Maniacs, Limpers.
    *   **Examples:** Passive Fish, Aggressive Fish.

4.  **LIGHT BLUE (Passive Reg / Weak Tight):**
    *   **Criteria:** Normal VPIP (20-25) but Low PFR/3-Bet (Passive).
    *   **Meaning:** Predictable. Won't bluff. Folds to aggression.
    *   **Examples:** "Fit or Fold" Regs.

5.  **GREY (Unknown):**
    *   **Criteria:** Sample size < 50 hands with no extreme stats.

### **Strategic Philosophy (Micro-Stakes Exploit)**
*   **WSD (Won Showdown) is King:**
    *   WSD > 60% = Honest. If they bet river, FOLD.
    *   WSD < 45% = Calling Station or Spewy bluffer. VALUE BET THIN.
*   **3-Bet Tells:**
    *   3-Bet < 3% = AA/KK only. Always fold marginal hands.
    *   3-Bet > 10% = Bluffing light. 4-Bet bluff them or trap.
*   **The "Nit" Rule:** If a Nit calls the flop, they have a pair. If they raise the turn/river, they have the nuts.
*   **Bankroll Management:** The user is grinding from NL5 to NL10 ($200 goal). Prioritize low-variance, high-EV plays.

### **Betting Heuristics & Hand Strength (The 0-1-2 System)**
Use this framework to evaluate "Hero's" decisions vs Bet Sizes and Board Texture.

**1. Bet Sizing Classification (Facing a Bet)**
*   **Small (0-50% Pot):** Score 0.5
*   **Medium (51-100% Pot):** Score 1.0
*   **Big (101-150% Pot):** Score 1.5
*   **Very Large (>150% Pot):** Score 2.0+

**2. Hand Strength Categories (The "0-1-2" Rule)**
*   **2 (Premium):** Strong Top Pair+, Premium Overpairs. -> **Action:** Bet / Raise / Call Large.
*   **1 (Marginal):** Weak Top Pair, Middle Pair, Good Draws. -> **Action:** Check / Call Small-Medium / Pot Control.
*   **0 (Junk):** Weak pairs, Air. -> **Action:** Check / Fold.

**3. Required Strength Matrix (Facing a Bet)**
*   *Columns = Bet Size Score (0.5, 1-2, 2.5+)*
*   *Rows = Board Texture*
*   **3 Paired Cards:** [Tight] | [Tight] | [Tight+]
*   **4 Flush Cards:** [Tight] | [Tight+] | [Tight+]
*   **4 Straight Cards:** [Tight] | [Tight] | [Tight+]
*   **3 Flush Cards:** [Tight] | [Tight] | [Tight]
*   **Low Cards:** [Loose+] | [Loose] | [Tight]
*   **High Card:** [Loose] | [Tight] | [Tight]

**4. Definitions of Range Strength**
*   **Tight+:** Nuts or Near Nuts (Str. Flush, Quads, Strong FH, Nut Flush on 4-flush board).
*   **Tight:** Set, Trips (Good Kicker), Two Pair, Overpair, TPTK, NFD, Combo Draw.
*   **Loose:** TP (Weak Kicker), Gutshot.
*   **Loose+:** Second Pair, Overcards, BDFD to Nuts.

**5. Heuristic Rules**
*   **Multi-way:** Check more often. Play tighter.
*   **Evaluation:** If Hero continues with a "Loose" hand when the Matrix requires "Tight", mark it as a **MISTAKE**.
        `;
    }

    static _rankToWord(rank) {
        switch (rank) {
            case 14: return 'Ace';
            case 13: return 'King';
            case 12: return 'Queen';
            case 11: return 'Jack';
            case 10: return 'Ten';
            case 9: return 'Nine';
            case 8: return 'Eight';
            case 7: return 'Seven';
            case 6: return 'Six';
            case 5: return 'Five';
            case 4: return 'Four';
            case 3: return 'Three';
            case 2: return 'Two';
            default: throw new Error(`Invalid rank: ${rank}`);
        }
    }

    static _rankCharToValue(ch) {
        switch (ch) {
            case 'A': return 14;
            case 'K': return 13;
            case 'Q': return 12;
            case 'J': return 11;
            case 'T': return 10;
            case '9': return 9;
            case '8': return 8;
            case '7': return 7;
            case '6': return 6;
            case '5': return 5;
            case '4': return 4;
            case '3': return 3;
            case '2': return 2;
            default: throw new Error(`Invalid rank char: ${ch}`);
        }
    }

    static _suitCharToWord(ch) {
        switch (ch) {
            case 's': return 'spades';
            case 'h': return 'hearts';
            case 'd': return 'diamonds';
            case 'c': return 'clubs';
            default: throw new Error(`Invalid suit char: ${ch}`);
        }
    }

    static _parseCardStr(cardStr) {
        if (typeof cardStr !== 'string') throw new Error(`Invalid card: ${cardStr}`);
        const c = cardStr.trim().replace('10', 'T');
        if (c.length !== 2) throw new Error(`Invalid card format: "${cardStr}"`);
        const rankChar = c[0].toUpperCase();
        const suitChar = c[1].toLowerCase();
        return { rank: this._rankCharToValue(rankChar), suit: suitChar };
    }

    static _parseHoleCardsFromHandStr(handStr) {
        if (typeof handStr !== 'string') throw new Error('Hero handStr missing');
        const cleaned = handStr.replace(/\s+/g, '').replace(/10/g, 'T');
        if (cleaned.length % 2 !== 0) throw new Error(`Invalid hero handStr: "${handStr}"`);
        const out = [];
        for (let i = 0; i < cleaned.length; i += 2) {
            out.push(this._parseCardStr(cleaned.slice(i, i + 2)));
        }
        if (out.length !== 2) {
            // We only support NLHE for solver-based street evaluation.
            throw new Error(`Hero hand must be 2 cards (NLHE). Got ${out.length} cards: "${handStr}"`);
        }
        return out;
    }

    static _cardObjToPretty(cardObj) {
        const r = this._rankToWord(cardObj.rank);
        const s = this._suitCharToWord(cardObj.suit);
        return `${r} of ${s}`;
    }

    static _handToEnglish(bestHand) {
        if (!bestHand || !bestHand.name || !Array.isArray(bestHand.values)) {
            throw new Error('Invalid PokerSolver hand object');
        }

        const v = bestHand.values;
        const r = (x) => this._rankToWord(x);

        switch (bestHand.name) {
            case 'Straight Flush':
                return `Straight flush (${r(v[0])}-high)`;
            case 'Four of a Kind':
                return `Four of a kind (${r(v[0])}s), kicker ${r(v[1])}`;
            case 'Full House':
                return `Full house (${r(v[0])}s full of ${r(v[1])}s)`;
            case 'Flush':
                return `Flush (${r(v[0])}-high)`;
            case 'Straight':
                return `Straight (${r(v[0])}-high)`;
            case 'Three of a Kind':
                return `Three of a kind (${r(v[0])}s)`;
            case 'Two Pair':
                return `Two pair (${r(v[0])}s and ${r(v[1])}s), kicker ${r(v[2])}`;
            case 'Pair':
                return `Pair of ${r(v[0])}s`;
            case 'High Card':
                return `High card (${r(v[0])}-high)`;
            default:
                // Fail fast so we notice if solver changes.
                throw new Error(`Unknown hand type from solver: "${bestHand.name}"`);
        }
    }

    static _computeStraightRunInfo(ranks) {
        if (!Array.isArray(ranks)) throw new Error('ranks must be an array');
        const uniq = Array.from(new Set(ranks)).sort((a, b) => a - b);
        if (uniq.length === 0) {
            return { maxRun: 0, uniqueSorted: [], isStraight5: false };
        }

        // A can be used as 1 for wheel detection (A-2-3-4-5)
        const withWheelAce = uniq.includes(14) ? [...uniq, 1].sort((a, b) => a - b) : uniq;

        let maxRun = 1;
        let run = 1;
        for (let i = 1; i < withWheelAce.length; i++) {
            if (withWheelAce[i] === withWheelAce[i - 1]) continue;
            if (withWheelAce[i] === withWheelAce[i - 1] + 1) {
                run++;
                maxRun = Math.max(maxRun, run);
            } else {
                run = 1;
            }
        }

        const isStraight5 = (uniq.length === 5 && maxRun >= 5);
        return { maxRun, uniqueSorted: uniq, isStraight5 };
    }

    static _computeBoardTexture(boardCards) {
        if (!Array.isArray(boardCards)) throw new Error('boardCards must be an array');
        const ranks = boardCards.map(c => c.rank);
        const suits = boardCards.map(c => c.suit);

        const rankCounts = {};
        for (const r of ranks) rankCounts[r] = (rankCounts[r] || 0) + 1;
        const suitCounts = {};
        for (const s of suits) suitCounts[s] = (suitCounts[s] || 0) + 1;

        const maxSuitCount = Object.values(suitCounts).reduce((m, v) => Math.max(m, v), 0);
        const paired = Object.values(rankCounts).some(v => v >= 2);
        const trips = Object.values(rankCounts).some(v => v >= 3);
        const quads = Object.values(rankCounts).some(v => v >= 4);

        const { maxRun, uniqueSorted, isStraight5 } = this._computeStraightRunInfo(ranks);
        const fourToStraight = maxRun >= 4;
        const threeToStraight = maxRun >= 3;

        const flushOnBoard = boardCards.length === 5 && maxSuitCount >= 5;
        const fourToFlush = maxSuitCount >= 4;
        const threeToFlush = maxSuitCount >= 3;

        return {
            cardCount: boardCards.length,
            ranksUniqueSorted: uniqueSorted,
            maxStraightRun: maxRun,
            straightOnBoard: isStraight5,
            fourToStraightOnBoard: fourToStraight,
            threeToStraightOnBoard: threeToStraight,
            maxSuitCount,
            flushOnBoard,
            fourToFlushOnBoard: fourToFlush,
            threeToFlushOnBoard: threeToFlush,
            paired,
            trips,
            quads
        };
    }

    static _validateNoDuplicateCards(label, cardStrs) {
        const seen = new Set();
        for (const c of cardStrs) {
            const raw = String(c).trim().replace('10', 'T');
            const norm = raw.length === 2 ? `${raw[0].toUpperCase()}${raw[1].toLowerCase()}` : raw;
            if (seen.has(norm)) throw new Error(`Duplicate card detected in ${label}: ${norm}`);
            seen.add(norm);
        }
    }

    static _validateNoCardOverlap(labelA, cardStrsA, labelB, cardStrsB) {
        const norm = (c) => {
            const raw = String(c).trim().replace('10', 'T');
            return raw.length === 2 ? `${raw[0].toUpperCase()}${raw[1].toLowerCase()}` : raw;
        };
        const a = new Set(cardStrsA.map(norm));
        for (const c of cardStrsB) {
            const n = norm(c);
            if (a.has(n)) throw new Error(`Card overlap detected between ${labelA} and ${labelB}: ${n}`);
        }
    }

    static buildHeroHandByStreetSummary(handData) {
        if (!handData?.hero?.handStr) throw new Error('Cannot build hero hand summary: missing hero hand');
        if (handData.variant && handData.variant !== 'NLHE') {
            throw new Error(`Hero hand-by-street evaluation currently supports NLHE only. Got variant: ${handData.variant}`);
        }
        if (!window.PokerSolver?.evaluateHand) throw new Error('PokerSolver not loaded (required for hero hand evaluation)');

        const heroCards = this._parseHoleCardsFromHandStr(handData.hero.handStr);
        const preflopPretty = heroCards.map(c => this._cardObjToPretty(c)).join(' + ');

        const flop = handData?.streets?.flop?.card || [];
        const turn = handData?.streets?.turn?.card || [];
        const river = handData?.streets?.river?.card || [];

        // Fail fast on duplicated cards (prevents silent nonsense).
        this._validateNoDuplicateCards('board', [...flop, ...turn, ...river]);
        const heroCardStrs = handData.hero.handStr.match(/.{1,2}/g) || [];
        this._validateNoDuplicateCards('hero hand', heroCardStrs);
        this._validateNoCardOverlap('hero hand', heroCardStrs, 'board', [...flop, ...turn, ...river]);

        const boardFlop = flop.map(c => this._parseCardStr(c));
        const boardTurn = [...flop, ...turn].map(c => this._parseCardStr(c));
        const boardRiver = [...flop, ...turn, ...river].map(c => this._parseCardStr(c));

        const lines = [];
        lines.push(`- Preflop: ${handData.hero.handStr} (${preflopPretty})`);

        if (boardFlop.length === 3) {
            const best = PokerSolver.evaluateHand([...heroCards, ...boardFlop]);
            lines.push(`- Flop [${flop.join(' ')}]: ${this._handToEnglish(best)}`);
        }
        if (boardTurn.length === 4) {
            const boardLabel = [...flop, ...turn].join(' ');
            const best = PokerSolver.evaluateHand([...heroCards, ...boardTurn]);
            lines.push(`- Turn [${boardLabel}]: ${this._handToEnglish(best)}`);
        }
        if (boardRiver.length === 5) {
            const boardLabel = [...flop, ...turn, ...river].join(' ');
            const best = PokerSolver.evaluateHand([...heroCards, ...boardRiver]);
            lines.push(`- River [${boardLabel}]: ${this._handToEnglish(best)}`);
        }

        return lines.join('\n');
    }

    static _determineHeuristicCategory(texture, ranks) {
        if (!texture || !ranks || ranks.length === 0) return 'N/A';
        
        // 1. 3 Paired Cards (Trips or Quads on board)
        // User Heuristic: "3 Paired Cards" -> Tight+ (Quads/FH)
        if (texture.trips || texture.quads) return '3 Paired Cards';

        // 2. 4 Flush Cards
        if (texture.fourToFlushOnBoard) return '4 Flush Cards';

        // 3. 4 Straight Cards
        if (texture.fourToStraightOnBoard) return '4 Straight Cards';

        // 4. 3 Flush Cards
        if (texture.threeToFlushOnBoard) return '3 Flush Cards';

        // 5. High Card (Any card >= 10) vs Low Cards
        // "High Card" heuristic implies board connects with broadway ranges.
        const maxRank = Math.max(...ranks);
        if (maxRank >= 10) return 'High Card';
        
        return 'Low Cards';
    }

    static buildBoardFactsByStreetSummary(handData) {
        if (!handData?.streets) throw new Error('Cannot build board facts: missing streets');
        if (!window.PokerSolver?.evaluateHand) throw new Error('PokerSolver not loaded (required for board evaluation)');

        const flop = handData?.streets?.flop?.card || [];
        const turn = handData?.streets?.turn?.card || [];
        const river = handData?.streets?.river?.card || [];
        const allBoard = [...flop, ...turn, ...river];
        this._validateNoDuplicateCards('board', allBoard);

        const summarize = (streetName, rawCards) => {
            if (!rawCards || rawCards.length === 0) return null;
            const parsed = rawCards.map(c => this._parseCardStr(c));
            const ranks = parsed.map(c => c.rank);
            const texture = this._computeBoardTexture(parsed);
            const heuristicCategory = this._determineHeuristicCategory(texture, ranks);

            let boardOnlyBest = null;
            if (parsed.length === 5) {
                const best = PokerSolver.evaluateHand(parsed);
                boardOnlyBest = this._handToEnglish(best);
            }

            return {
                street: streetName,
                cards: rawCards,
                boardOnlyBestHandIf5Cards: boardOnlyBest,
                texture,
                heuristicCategory // Deterministic classification for the user's matrix
            };
        };

        const flopObj = summarize('flop', flop);
        const turnObj = summarize('turn', [...flop, ...turn]);
        const riverObj = summarize('river', [...flop, ...turn, ...river]);

        const payload = {
            note: 'These facts are computed from the parsed board. Treat as ground truth.',
            flop: flopObj,
            turn: turnObj,
            river: riverObj
        };

        // Avoid backticks in prompts (template literal safety). Use clear sentinels instead.
        return `BOARD_FACTS_JSON_START\n${JSON.stringify(payload, null, 2)}\nBOARD_FACTS_JSON_END`;
    }

    setApiKey(key) {
        this.apiKey = key;
        localStorage.setItem('openrouter_api_key', key);
    }

    setModel(model) {
        this.model = model;
        localStorage.setItem('openrouter_model', model);
    }

    hasApiKey() {
        return !!this.apiKey;
    }

    async analyze(context) {
        if (!this.apiKey) {
            throw new Error('API Key missing');
        }

        const systemPrompt = `
You are a Poker Strategy Expert specializing in Micro-Stakes GTO and Exploitative adjustments.
Your goal is to interpret GTO ranges for the user and provide actionable advice.

CONTEXT PROVIDED:
- Scenario: ${context.scenarioName}
- Hero Position: ${context.heroPos}
- Hand: ${context.hand}
- GTO Strategy: ${JSON.stringify(context.strategy)}
- Board (if any): ${context.board || 'Preflop'}

INSTRUCTIONS:
1. State the GTO frequency clearly (e.g., "GTO opens this 15% of the time").
2. Explain the *logic* (why is it mixed? Board coverage? Blocker?).
3. Provide a Micro-Stakes Adjustment (should they over-fold or over-bluff this specific spot vs population?).
4. Keep it concise (< 150 words).
        `;

        try {
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'HTTP-Referer': window.location.origin, // Required by OpenRouter
                    'X-Title': 'Poker Odds Calculator', // Optional
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: `Analyze ${context.hand} in ${context.scenarioName}` }
                    ]
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error?.message || 'API Request failed');
            }

            const data = await response.json();
            return data.choices[0].message.content;

        } catch (error) {
            console.error('LLM Error:', error);
            throw error;
        }
    }

    // New method for full hand history analysis
    async analyzeHandHistory(data) {
        if (!this.apiKey) throw new Error('API Key missing');

        // This method is kept for compatibility but we will enhance it if 'parser' and 'treeManager' were used in previous steps.
        // But better: define a new robust method below and call it if possible, or upgrade this one.
        
        // Since we cannot easily change the call site in index.html/gto-charts.html without editing them, 
        // we will adapt this method to check if 'data' is the legacy format or the new rich format.
        
        // Legacy 'data' has: rawHistory, heroName, heroPos, heroHand, etc.
        // We will just use the text and re-parse using our new robust parser if available?
        // Actually, the user asked for this specific behavior "When analyzing the hand".
        // The most reliable way is to let the UI call this method, and we handle the parsing internally if we have the raw text.

        // However, the 'data' object passed here is constructed in the UI (gto-charts.html).
        // Let's assume the UI code (which we didn't change yet) calls this. 
        // We should probably update the UI code to call a new method `analyzeFullHand` or update `analyzeHandHistory` to do the heavy lifting.
        
        // Let's implement `analyzeFullHand` and I will explain to the user that I updated the service.
        // But to make it work 'out of the box' with existing buttons, I should check if I can modify the UI code.
        // I saw `gto-charts.html` has the click handler. I will modify that file to call `analyzeFullHand`.
        
        return "Please use analyzeFullHand() for the new deep analysis.";
    }

    static normalizeHand(handStr) {
        // e.g. "AhKh" -> "AKs", "AhKd" -> "AKo", "5h5d" -> "55"
        if (!handStr) return null;
        const h = handStr.replace(/10/g, 'T').replace(/\s/g, '');
        if (h.length !== 4) return null; // must be 2 cards, 4 chars e.g. "AsKh"
        
        const r1 = h[0];
        const s1 = h[1];
        const r2 = h[2];
        const s2 = h[3];
        
        const ranks = 'AKQJT98765432';
        // Sort by rank index (lower index = higher rank)
        const i1 = ranks.indexOf(r1);
        const i2 = ranks.indexOf(r2);
        
        if (i1 === -1 || i2 === -1) return null;
        
        if (r1 === r2) return r1 + r2; // Pair
        
        if (s1 === s2) {
            // Suited
            return (i1 < i2 ? r1 + r2 : r2 + r1) + 's';
        } else {
            // Offsuit
            return (i1 < i2 ? r1 + r2 : r2 + r1) + 'o';
        }
    }

    async analyzeFullHand(rawText, parser, treeManager) {
        if (!this.apiKey) throw new Error('API Key missing');

        // 1. Parse Hand
        const handData = parser.parse(rawText);
        if (!handData.hero) throw new Error("Could not find Hero in hand history.");

        // 2. Enhance Data with Stats & GTO
        const streetsAnalysis = [];

        // --- PREFLOP ---
        const preflop = handData.streets.preflop;
        let preflopContext = "";
        
        // Find Hero's first significant action
        const heroActionPF = preflop.actions.find(a => a.player === handData.hero.name && (a.type === 'raise' || a.type === 'call' || a.type === 'fold'));
        
        let villainName = null;
        let villainStats = null;
        let gtoInfo = "GTO Data not available (check DB)";

        // Try to identify main Villain (last aggressor before Hero)
        // ... (Logic similar to treeManager.deriveContext but using the parsed actions)
        
        // Fetch GTO for Preflop
        if (treeManager) {
            // We need to map the parsed actions to the treeManager's context logic
            // This is complex to do perfectly, but we can try the fuzzy match or just report the RFI/Facing Raise state.
            // For now, let's ask the LLM to analyze based on standard charts if we can't find exact match.
            // But the user said "Rely on GTO charts".
            
            // Try to get strategy
            try {
                // Simplified: Is it RFI?
                const actsBeforeHero = preflop.actions.filter(a => a !== heroActionPF && preflop.actions.indexOf(a) < preflop.actions.indexOf(heroActionPF));
                const raises = actsBeforeHero.filter(a => a.type === 'raise');
                
                let context = { isRFI: raises.length === 0, villainPos: 'Blinds', prevAction: 'Fold' };
                if (raises.length > 0) {
                    const lastRaise = raises[raises.length-1];
                    const vObj = handData.players.find(p => p.name === lastRaise.player);
                    context = { 
                        isRFI: false, 
                        villainPos: vObj ? vObj.pos : 'Unknown', 
                        prevAction: `Raise ${lastRaise.amount}` // This might need normalization
                    };
                }

                // If Hero is SB/BB and it's RFI, context is different.
                
                // Get Strategy
                const strat = treeManager.getStrategyForContext(handData.hero.pos, context.villainPos, context.prevAction, context.isRFI);
                if (strat && strat[LLMService.normalizeHand(handData.hero.handStr)]) {
                    gtoInfo = JSON.stringify(strat[LLMService.normalizeHand(handData.hero.handStr)]);
                }
            } catch (e) { console.warn("GTO lookup failed", e); }
        }

        // Get Villain Stats
        // Find players who put money in the pot with Hero or interacted meaningfully
        let villains = [];
        const interactors = handData.players.filter(p => {
            if (p.name === handData.hero.name) return false;
            // Did they raise?
            const raised = preflop.actions.some(a => a.player === p.name && a.type === 'raise');
            if (raised) return true;
            // Did they call?
            const called = preflop.actions.some(a => a.player === p.name && a.type === 'call');
            if (called) return true;
            return false;
        });

        if (interactors.length > 0) {
            villains = interactors;
        } else {
             // Fallback: anyone who didn't fold
            const survivors = handData.players.filter(p => {
                const acts = preflop.actions.filter(a => a.player === p.name);
                const last = acts[acts.length-1];
                return last && last.type !== 'fold' && p.name !== handData.hero.name;
            });
            villains = survivors;
        }
        
        // Fetch stats for all identified villains
        let villainStatsList = [];
        if (treeManager && villains.length > 0) {
            try {
                const promises = villains.map(async v => {
                    const s = await treeManager.getVillainStats(v.name);
                    return { name: v.name, stats: s };
                });
                villainStatsList = await Promise.all(promises);
            } catch (err) {
                console.error("Error fetching villain stats:", err);
            }
        }

        const statsStr = villainStatsList.length > 0 ? 
            villainStatsList.map(v => {
                const s = v.stats;
                if (!s) return `Villain (${v.name}): Unknown/No Data`;
                return `Villain (${v.name}) Stats: VPIP: ${s.vpip?.toFixed(1)}, PFR: ${s.pfr?.toFixed(1)}, 3B: ${s.three_bet?.toFixed(1)}, WSD: ${s.wsd?.toFixed(1)}`;
            }).join('\n- ') : 
            "Villain Stats: Unknown/Not found in DB";

        // Build Street Summaries
        const buildStreetLog = (streetName, streetData) => {
            if (!streetData || streetData.actions.length === 0) return null;
            
            const logs = streetData.actions.map(a => {
                let extra = "";
                if (a.player === handData.hero.name && a.math) {
                    extra = ` (Pot Odds: ${a.math.potOddsPct}%, Pot: ${a.math.potSize})`;
                }
                return `- ${a.player}: ${a.type} ${a.amount > 0 ? a.amount : ''}${extra}`;
            }).join('\n');

            return `
=== ${streetName.toUpperCase()} ===
Cards: ${streetData.card ? streetData.card.join(' ') : 'None'}
Actions:
${logs}
            `;
        };

        const historyLog = [
            buildStreetLog('Preflop', handData.streets.preflop),
            buildStreetLog('Flop', handData.streets.flop),
            buildStreetLog('Turn', handData.streets.turn),
            buildStreetLog('River', handData.streets.river)
        ].filter(x => x).join('\n');

        const heroHandByStreet = LLMService.buildHeroHandByStreetSummary(handData);
        const boardFactsByStreet = LLMService.buildBoardFactsByStreetSummary(handData);

        const systemPrompt = `
You are an expert Poker Analyst and Coach for Micro-Stakes CoinPoker games.
I will provide a full hand history. You must analyze every street, synthesizing Math, GTO, and Exploitative Fundamentals.

${this.FUNDAMENTALS}

### **Your Task**
1.  **Analyze Preflop:** Compare Hero's move to the GTO strategy provided.
2.  **Analyze Postflop (Street by Street):**
    *   Evaluate Pot Odds & MDF where relevant (data provided).
    *   Use Villain Stats (if available) to assign a COLOR (Red, Orange, Green, Blue).
    *   Apply the "Strategic Philosophy" (e.g., Fold if Nit raises turn).
3.  **Final Score:** Give the play a score out of 10.
4.  **Format:** Use Markdown with bolding for key insights.
5.  **Critical:** At the start of each street section, restate "Hero has: ..." using the provided computed street hand summary. Do not contradict it.
6.  **Critical Board Rule:** When you discuss board texture (straight/flush being on the board, 4-to-a-straight, 4-to-a-flush, etc.), you MUST use the provided BOARD_FACTS_JSON. If it says straightOnBoard=false, you must NOT claim there is a straight on the board.
7.  **Deterministic Heuristic:** For the "Facing a Bet" matrix, you MUST use the \`heuristicCategory\` provided in BOARD_FACTS_JSON for each street (e.g., "High Card", "3 Flush Cards"). Do not guess the category yourself.
8.  **If you detect contradictions:** Stop and explicitly say "DATA ERROR" and quote the conflicting fields from BOARD_FACTS_JSON.

**Constraints:**
*   DO NOT calculate equity yourself. Use the provided numbers or general principles.
*   Be specific about the "Why".
        `;

        const userContent = `
**Hand Details:**
- Hero: ${handData.hero.name} (${handData.hero.pos})
- Hand: ${handData.hero.handStr}
- GTO Strategy (Preflop): ${gtoInfo}
- ${statsStr}

**Hero Hand Strength by Street (Computed / Deterministic):**
${heroHandByStreet}

**Board Facts by Street (Computed / Deterministic):**
${boardFactsByStreet}

**Hand History & Math:**
${historyLog}
`;

        try {
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'HTTP-Referer': window.location.origin,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userContent }
                    ]
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error?.message || 'API Request failed');
            }

            const data = await response.json();
            return data.choices[0].message.content;

        } catch (error) {
            console.error('LLM Error:', error);
            throw error;
        }
    }
}
