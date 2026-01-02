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
                    villainName = lastRaise.player;
                }

                // If Hero is SB/BB and it's RFI, context is different.
                
                // Get Strategy
                const strat = treeManager.getStrategyForContext(handData.hero.pos, context.villainPos, context.prevAction, context.isRFI);
                if (strat && strat[treeManager.normalizeHand(handData.hero.handStr)]) {
                    gtoInfo = JSON.stringify(strat[treeManager.normalizeHand(handData.hero.handStr)]);
                }
            } catch (e) { console.warn("GTO lookup failed", e); }
        }

        // Get Villain Stats
        // Find the player who put money in the pot with Hero
        // Identify "Main Villain" for the hand (who saw flop with hero, or who raised hero)
        if (!villainName) {
            // Look for anyone who didn't fold
            const survivors = handData.players.filter(p => {
                const acts = preflop.actions.filter(a => a.player === p.name);
                const last = acts[acts.length-1];
                return last && last.type !== 'fold' && p.name !== handData.hero.name;
            });
            if (survivors.length > 0) villainName = survivors[0].name;
        }

        if (villainName && treeManager) {
            villainStats = treeManager.getVillainStats(villainName);
        }

        const statsStr = villainStats ? 
            `Villain (${villainName}) Stats: VPIP: ${villainStats.vpip?.toFixed(1)}, PFR: ${villainStats.pfr?.toFixed(1)}, 3B: ${villainStats.three_bet?.toFixed(1)}, WSD: ${villainStats.wsd?.toFixed(1)}` : 
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
