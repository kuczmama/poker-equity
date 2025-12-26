/**
 * Poker Leak Quiz - Doug Polk Style
 * 
 * Key principles:
 * 1. At microstakes, exploit - they don't bluff enough
 * 2. Understand pot odds and equity mathematically
 * 3. Position is everything
 * 4. When in doubt, fold marginal spots (especially OOP)
 * 5. Mixing spots = both answers acceptable
 * 
 * ALL CALCULATIONS ARE DYNAMIC - no hardcoded equity values in explanations
 */

// ============================================
// EQUITY & ODDS CALCULATION ENGINE
// ============================================

const PokerMath = {
    // Calculate pot odds as a percentage
    // For river spots: pot is BEFORE villain's bet, toCall IS villain's bet
    // Required equity = toCall / (pot + toCall + toCall) = toCall / (pot + 2*toCall)
    // For preflop: pot usually includes villain's bet already
    calculatePotOdds(pot, toCall, potIncludesBet = true) {
        if (potIncludesBet) {
            // Pot already includes villain's bet (preflop scenarios)
            return toCall / (pot + toCall);
        } else {
            // Pot is BEFORE villain's bet (river scenarios)
            // Pot after bet = pot + toCall, then we call toCall more
            return toCall / (pot + toCall + toCall);
        }
    },
    
    // Calculate implied odds multiplier based on hand properties and position
    getImpliedOddsMultiplier(hand, hasPosition) {
        let multiplier = 1.0;
        
        // Pocket pairs: set mining value (~7.5:1 to flop a set)
        // With 100bb stacks, need to win ~15x the call to profit from set mining
        if (hand.isPair) {
            multiplier += hasPosition ? 0.12 : 0.06;
        }
        
        // Suited hands: can make flushes (~15:1 to flop flush draw, ~4:1 to complete)
        if (hand.suited) {
            multiplier += hasPosition ? 0.06 : 0.03;
        }
        
        // Connected hands: straight potential
        if (Math.abs(hand.rank1 - hand.rank2) <= 2 && hand.rank1 !== hand.rank2) {
            multiplier += hasPosition ? 0.04 : 0.02;
        }
        
        // Position adds ability to realize equity
        if (hasPosition) {
            multiplier += 0.05;
        }
        
        return multiplier;
    },
    
    // Calculate EV of calling
    // EV = (equity * potWon) - amountRisked
    calculateCallEV(equity, potAfterCall, toCall) {
        return (equity * potAfterCall) - toCall;
    },
    
    // GTO bluff frequency formula: b/(b+p) where b=bet, p=pot before bet
    // This makes hero indifferent between calling and folding with bluff catchers
    calculateGTOBluffFrequency(betSize) {
        // betSize is bet/pot ratio (e.g., 2.0 for 2x pot)
        return betSize / (betSize + 1);
    },
    
    // Estimate actual bluff frequency at microstakes
    // Research shows micros bluff 15-35% of GTO frequency depending on spot
    estimateMicroBluffFrequency(betSize, boardTexture) {
        const gtoBluffFreq = this.calculateGTOBluffFrequency(betSize);
        
        // Factors that reduce bluffing at microstakes:
        // 1. Scary boards (flush/straight complete) - players "know" they're beat
        // 2. Large bet sizes - players scared of getting called
        // 3. Check-raises - almost always value at micros
        
        let microAdjustment = 0.25; // Base: micros bluff 25% of GTO
        
        if (boardTexture.flushComplete) {
            microAdjustment *= 0.4; // 4-flush boards = way less bluffing
        }
        if (boardTexture.straightComplete) {
            microAdjustment *= 0.5;
        }
        if (betSize >= 1.5) {
            microAdjustment *= 0.7; // Big bets = less bluffing
        }
        if (betSize >= 2.0) {
            microAdjustment *= 0.6; // 2x pot+ = rarely bluffing
        }
        
        return gtoBluffFreq * microAdjustment;
    },
    
    // Calculate minimum defense frequency
    getMDF(betSize) {
        return 1 / (1 + betSize);
    }
};

// ============================================
// VILLAIN RANGE DEFINITIONS
// These define what hands villain likely has in each spot
// ============================================

const VILLAIN_RANGES = {
    // EP 4-bet range: Very tight (QQ+, AK, maybe some bluffs)
    'EP_4bet': {
        value: ['AA', 'KK', 'QQ', 'AKs', 'AKo'],
        bluffs: ['A5s', 'A4s'], // Small suited aces as bluffs
        description: 'EP 4-bet range is very tight: QQ+, AK'
    },
    // CO 4-bet range: Slightly wider
    'CO_4bet': {
        value: ['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo', 'AQs'],
        bluffs: ['A5s', 'A4s', 'A3s'],
        description: 'CO 4-bet range includes JJ and AQs'
    },
    // BTN 4-bet range: Widest
    'BTN_4bet': {
        value: ['AA', 'KK', 'QQ', 'JJ', 'TT', 'AKs', 'AKo', 'AQs', 'AQo'],
        bluffs: ['A5s', 'A4s', 'A3s', 'A2s', 'K5s'],
        description: 'BTN 4-bet range is wide: TT+, AQ+'
    },
    // BTN 3-bet range vs EP/CO
    'BTN_3bet': {
        value: ['AA', 'KK', 'QQ', 'JJ', 'TT', 'AKs', 'AKo', 'AQs', 'AQo', 'AJs'],
        bluffs: ['A5s', 'A4s', 'K9s', 'Q9s', '87s', '76s'],
        description: 'BTN 3-bet range is wide with suited bluffs'
    },
    // BB 3-bet range (widest of all)
    'BB_3bet': {
        value: ['AA', 'KK', 'QQ', 'JJ', 'TT', '99', 'AKs', 'AKo', 'AQs', 'AQo', 'AJs', 'ATs', 'KQs'],
        bluffs: ['A5s', 'A4s', 'A3s', 'A2s', 'K9s', 'Q9s', 'J9s', '87s', '76s', '65s', '54s'],
        description: 'BB defends wide and 3-bets light'
    },
    // SB 3-bet range
    'SB_3bet': {
        value: ['AA', 'KK', 'QQ', 'JJ', 'TT', 'AKs', 'AKo', 'AQs', 'AQo', 'AJs'],
        bluffs: ['A5s', 'A4s', 'K9s', '87s', '76s'],
        description: 'SB 3-bets tighter than BB but still has bluffs'
    }
};

// ============================================
// EQUITY CALCULATOR
// Calculates equity vs defined ranges
// ============================================

const EquityCalculator = {
    // Get equity vs a specific range
    calculateEquityVsRange(hand, rangeKey) {
        const range = VILLAIN_RANGES[rangeKey];
        if (!range) {
            return this.estimateEquityGeneric(hand);
        }
        
        // Calculate equity vs value hands and bluffs separately
        const vsValue = this.estimateVsValueRange(hand, range.value);
        const vsBluffs = this.estimateVsBluffRange(hand, range.bluffs);
        
        // Weight: assume villain 4-bets/3-bets ~80% value, 20% bluffs at micros
        // (GTO is closer to 60/40 but micros are tighter)
        const valueWeight = 0.85;
        const bluffWeight = 0.15;
        
        return (vsValue * valueWeight) + (vsBluffs * bluffWeight);
    },
    
    estimateVsValueRange(hand, valueHands) {
        // Estimate equity vs villain's value range
        const dominated = this.isDominated(hand, valueHands);
        const dominating = this.isDominating(hand, valueHands);
        
        if (hand.isPair) {
            // Pairs vs value range
            const pairRank = hand.rank1;
            // Count how many value hands we're ahead of, behind, or flipping
            let ahead = 0, behind = 0, flipping = 0;
            
            for (const vh of valueHands) {
                const vhParsed = this.parseHandName(vh);
                if (vhParsed.isPair) {
                    if (pairRank > vhParsed.rank1) ahead++;
                    else if (pairRank < vhParsed.rank1) behind++;
                    else flipping++; // Same pair
                } else {
                    // Pair vs unpaired: we're ~55% favorite if not dominated
                    if (vhParsed.rank1 === pairRank || vhParsed.rank2 === pairRank) {
                        flipping++; // They have one of our cards
                    } else if (vhParsed.rank1 > pairRank && vhParsed.rank2 > pairRank) {
                        flipping++; // Both overcards
                    } else {
                        ahead++;
                    }
                }
            }
            
            const total = ahead + behind + flipping;
            if (total === 0) return 0.40;
            
            // Ahead = ~80% equity, behind = ~20%, flipping = ~50%
            return ((ahead * 0.80) + (behind * 0.20) + (flipping * 0.50)) / total;
        }
        
        // Unpaired hand
        if (dominated) return 0.25; // Dominated hands have ~25-30% equity
        if (dominating) return 0.70; // Dominating hands have ~70%
        
        // Check for overcards, blockers, etc.
        const hasAce = hand.rank1 === 14 || hand.rank2 === 14;
        const hasKing = hand.rank1 === 13 || hand.rank2 === 13;
        const isBroadway = hand.rank1 >= 10 && hand.rank2 >= 10;
        
        let baseEquity = 0.35;
        if (hasAce) baseEquity += 0.05;
        if (hasKing) baseEquity += 0.03;
        if (hand.suited) baseEquity += 0.03;
        if (isBroadway) baseEquity += 0.02;
        
        return Math.min(0.50, baseEquity);
    },
    
    estimateVsBluffRange(hand, bluffHands) {
        // Against bluffs we usually have 50-60% equity
        // Unless we're dominated by the bluffs too
        const dominated = this.isDominated(hand, bluffHands);
        if (dominated) return 0.35;
        return hand.isPair ? 0.55 : 0.50;
    },
    
    isDominated(hand, range) {
        // Check if hand is dominated by hands in range
        // Dominated = same high card but worse kicker, or same pair rank
        for (const rh of range) {
            const parsed = this.parseHandName(rh);
            // Same high card, worse kicker
            if (parsed.rank1 === hand.rank1 && parsed.rank2 > hand.rank2) return true;
            if (parsed.rank2 === hand.rank1 && !hand.isPair && parsed.rank1 > hand.rank2) return true;
        }
        return false;
    },
    
    isDominating(hand, range) {
        // Check if we dominate hands in range
        let dominated = 0;
        for (const rh of range) {
            const parsed = this.parseHandName(rh);
            if (hand.rank1 === parsed.rank1 && hand.rank2 > parsed.rank2) dominated++;
        }
        return dominated >= range.length * 0.3;
    },
    
    parseHandName(name) {
        const ranks = { 'A': 14, 'K': 13, 'Q': 12, 'J': 11, 'T': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 };
        const isPair = name.length === 2 && name[0] === name[1];
        const suited = name.endsWith('s');
        
        if (isPair) {
            return { rank1: ranks[name[0]], rank2: ranks[name[0]], isPair: true, suited: false };
        }
        return {
            rank1: ranks[name[0]],
            rank2: ranks[name[1]],
            isPair: false,
            suited: suited
        };
    },
    
    estimateEquityGeneric(hand) {
        // Fallback equity estimation
        if (hand.isPair) {
            if (hand.rank1 >= 12) return 0.55;
            if (hand.rank1 >= 10) return 0.45;
            if (hand.rank1 >= 8) return 0.40;
            return 0.35;
        }
        
        const hasAce = hand.rank1 === 14;
        const hasKing = hand.rank1 === 13 || hand.rank2 === 13;
        
        if (hasAce && hand.rank2 >= 12) return hand.suited ? 0.45 : 0.42;
        if (hasAce && hand.rank2 >= 10) return hand.suited ? 0.40 : 0.36;
        if (hasKing && hand.rank2 >= 11) return hand.suited ? 0.38 : 0.34;
        
        return hand.suited ? 0.32 : 0.28;
    }
};

// ============================================
// HAND PARSER
// ============================================

function parseHand(handArr) {
    // handArr = ['A', 's', 'K', 's'] or similar
    const ranks = { 'A': 14, 'K': 13, 'Q': 12, 'J': 11, 'T': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 };
    
    const rank1 = ranks[handArr[0]];
    const suit1 = handArr[1];
    const rank2 = ranks[handArr[2]];
    const suit2 = handArr[3];
    
    const isPair = rank1 === rank2;
    const suited = suit1 === suit2;
    
    // Generate hand name
    let name;
    if (isPair) {
        name = handArr[0] + handArr[0];
    } else {
        const highRank = rank1 > rank2 ? handArr[0] : handArr[2];
        const lowRank = rank1 > rank2 ? handArr[2] : handArr[0];
        name = highRank + lowRank + (suited ? 's' : 'o');
    }
    
    return {
        rank1: Math.max(rank1, rank2),
        rank2: Math.min(rank1, rank2),
        suit1, suit2,
        isPair, suited, name,
        cards: handArr
    };
}

// ============================================
// BOARD ANALYZER
// ============================================

function analyzeBoard(boardArr) {
    if (!boardArr || boardArr.length === 0) return null;
    
    const suits = {};
    const ranks = [];
    
    boardArr.forEach(card => {
        const suit = card[1];
        suits[suit] = (suits[suit] || 0) + 1;
        
        const rankMap = { 'A': 14, 'K': 13, 'Q': 12, 'J': 11, 'T': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 };
        ranks.push(rankMap[card[0]]);
    });
    
    const maxSuitCount = Math.max(...Object.values(suits));
    const flushComplete = maxSuitCount >= 4;
    const flushDraw = maxSuitCount === 3;
    const flushSuit = Object.keys(suits).find(s => suits[s] === maxSuitCount);
    
    // Check for straight possibilities
    ranks.sort((a, b) => a - b);
    let straightComplete = false;
    let straightDraw = false;
    
    // Simple straight detection (not perfect but good enough)
    const uniqueRanks = [...new Set(ranks)];
    for (let i = 0; i <= uniqueRanks.length - 4; i++) {
        if (uniqueRanks[i + 3] - uniqueRanks[i] <= 4) {
            straightDraw = true;
            if (uniqueRanks[i + 3] - uniqueRanks[i] === 3 && uniqueRanks.length >= 4) {
                straightComplete = true;
            }
        }
    }
    
    return {
        suits, ranks, flushComplete, flushDraw, flushSuit,
        straightComplete, straightDraw,
        isScary: flushComplete || straightComplete
    };
}

// ============================================
// DECISION ENGINE - DOUG POLK STYLE
// All calculations and explanations generated dynamically
// ============================================

const DecisionEngine = {
    // Evaluate a preflop spot and generate full analysis
    evaluatePreflopSpot(scenario) {
        const hand = parseHand(scenario.hand);
        const pot = parseFloat(scenario.pot);
        const toCall = parseFloat(scenario.toCall);
        const hasPosition = this.hasPosition(scenario.heroPosition, scenario.villainPosition);
        
        // Calculate pot odds (preflop pot includes villain's bet)
        const potOdds = PokerMath.calculatePotOdds(pot, toCall, true);
        const requiredEquity = potOdds;
        
        // Determine villain's range based on position and action
        const rangeKey = this.getVillainRangeKey(scenario);
        const villainRange = VILLAIN_RANGES[rangeKey];
        
        // Calculate raw equity vs villain's range
        const rawEquity = EquityCalculator.calculateEquityVsRange(hand, rangeKey);
        
        // Apply implied odds adjustment
        const impliedMultiplier = PokerMath.getImpliedOddsMultiplier(hand, hasPosition);
        const effectiveEquity = rawEquity * impliedMultiplier;
        
        // Calculate EV: (equity * pot_we_win) - cost_to_call
        const potAfterCall = pot + toCall;
        const ev = PokerMath.calculateCallEV(effectiveEquity, potAfterCall, toCall);
        
        // Determine if this is a mixing spot (EV close to 0)
        const evPerBB = ev; // EV in bb
        const isMixingSpot = Math.abs(evPerBB) < 2 && 
            effectiveEquity >= requiredEquity * 0.85 && 
            effectiveEquity <= requiredEquity * 1.15;
        
        // Determine correct action
        const shouldCall = effectiveEquity >= requiredEquity;
        
        // Generate dynamic explanation
        const explanation = this.generatePreflopExplanation({
            hand, pot, toCall, potOdds, requiredEquity,
            rawEquity, impliedMultiplier, effectiveEquity,
            hasPosition, ev, isMixingSpot, shouldCall,
            villainRange, rangeKey, scenario
        });
        
        return {
            hand, rawEquity, effectiveEquity, potOdds, requiredEquity,
            ev, hasPosition, impliedMultiplier, villainRange,
            shouldCall, isMixingSpot, explanation
        };
    },
    
    // Evaluate a river spot and generate full analysis
    evaluateRiverSpot(scenario) {
        const hand = parseHand(scenario.hand);
        const board = analyzeBoard(scenario.board);
        const pot = parseFloat(scenario.pot);
        const toCall = parseFloat(scenario.toCall);
        const betSize = toCall / pot;
        
        // Pot odds for river (pot is BEFORE villain's bet)
        const potAfterBet = pot + toCall;
        const totalPotIfCall = potAfterBet + toCall;
        const potOdds = PokerMath.calculatePotOdds(pot, toCall, false);
        const requiredEquity = potOdds;
        
        // Hand strength category
        const handStrength = this.categorizeHandStrength(scenario);
        
        // Check for blockers
        const hasBlocker = this.hasRelevantBlocker(hand, board);
        const blockerInfo = this.analyzeBlockers(hand, board);
        
        // Calculate GTO and micro bluff frequencies
        const gtoBluffFreq = PokerMath.calculateGTOBluffFrequency(betSize);
        const microBluffFreq = PokerMath.estimateMicroBluffFrequency(betSize, board);
        
        // Our equity vs villain's value and bluffs
        const vsValueEquity = this.calculateVsValueEquity(handStrength, board, hasBlocker);
        const vsBluffEquity = 1.0; // We always beat bluffs
        
        // Total equity calculation
        const valueFreq = 1 - microBluffFreq;
        const baseEquity = (microBluffFreq * vsBluffEquity) + (valueFreq * vsValueEquity);
        const blockerBonus = hasBlocker ? blockerInfo.bonus : 0;
        const totalEquity = Math.min(1.0, baseEquity + blockerBonus);
        
        // EV calculation
        const ev = (totalEquity * totalPotIfCall) - toCall;
        
        // Is this a mixing spot?
        const isMixingSpot = Math.abs(ev) < 5 && 
            totalEquity >= requiredEquity * 0.80 && 
            totalEquity <= requiredEquity * 1.20;
        
        const shouldCall = totalEquity >= requiredEquity;
        
        // Generate dynamic explanation
        const explanation = this.generateRiverExplanation({
            hand, board, pot, toCall, potAfterBet, totalPotIfCall,
            betSize, potOdds, requiredEquity,
            handStrength, hasBlocker, blockerInfo,
            gtoBluffFreq, microBluffFreq,
            vsValueEquity, vsBluffEquity, totalEquity,
            ev, isMixingSpot, shouldCall, scenario
        });
        
        return {
            hand, board, potOdds, requiredEquity,
            gtoBluffFreq, microBluffFreq,
            handStrength, hasBlocker, blockerInfo,
            vsValueEquity, totalEquity, ev,
            shouldCall, isMixingSpot, explanation
        };
    },
    
    getVillainRangeKey(scenario) {
        if (scenario.type === '4bet') {
            if (scenario.villainPosition === 'UTG' || scenario.villainPosition === 'EP') {
                return 'EP_4bet';
            } else if (scenario.villainPosition === 'CO') {
                return 'CO_4bet';
            } else {
                return 'BTN_4bet';
            }
        } else if (scenario.type === '3bet') {
            if (scenario.villainPosition === 'BB') {
                return 'BB_3bet';
            } else if (scenario.villainPosition === 'SB') {
                return 'SB_3bet';
            } else {
                return 'BTN_3bet';
            }
        }
        return 'BTN_3bet';
    },
    
    calculateVsValueEquity(handStrength, board, hasBlocker) {
        // When villain has value hands (flushes on flush boards, etc.)
        // what's our equity?
        
        if (handStrength === 'full_house' || handStrength === 'nuts') {
            return 0.95; // Beat almost all value
        }
        if (handStrength === 'nut_flush') {
            return 0.95; // Only lose to full houses
        }
        if (handStrength === 'weak_flush') {
            // 9-high flush loses to A, K, Q, J, T high flushes
            // That's roughly 5 better flushes out of ~9 possible flush combos
            // We beat ~40% of flushes and all bluffs
            return 0.30; // We beat weaker flushes but lose to most value
        }
        if (handStrength === 'flush' || handStrength === 'straight') {
            return board.flushComplete ? 0.60 : 0.85; // Might be outkicked
        }
        if (handStrength === 'set') {
            if (board.flushComplete) return 0; // Lose to all flushes
            if (board.straightComplete) return 0.3;
            return 0.85;
        }
        if (handStrength === 'two_pair') {
            if (board.flushComplete || board.straightComplete) return 0;
            return 0.60;
        }
        if (handStrength === 'overpair' || handStrength === 'top_pair') {
            if (board.flushComplete || board.straightComplete) return 0;
            return 0.30;
        }
        if (handStrength === 'second_pair') {
            return 0.20;
        }
        return 0;
    },
    
    analyzeBlockers(hand, board) {
        const result = { hasBlocker: false, bonus: 0, description: '' };
        
        if (!board) return result;
        
        if (board.flushComplete && board.flushSuit) {
            const flushSuit = board.flushSuit;
            const hasFlushBlocker = hand.suit1 === flushSuit || hand.suit2 === flushSuit;
            
            if (hasFlushBlocker) {
                // Having a blocker removes some flush combos from villain's range
                // High card blockers are better
                const blockerRank = hand.suit1 === flushSuit ? hand.rank1 : hand.rank2;
                
                if (blockerRank >= 14) {
                    result.bonus = 0.12; // Ace blocker
                    result.description = 'A♠ blocker removes nut flushes';
                } else if (blockerRank >= 13) {
                    result.bonus = 0.10;
                    result.description = 'K♠ blocker removes 2nd nut flushes';
                } else if (blockerRank >= 10) {
                    result.bonus = 0.07;
                    result.description = `${this.rankToChar(blockerRank)}♠ blocker removes some flushes`;
                } else {
                    result.bonus = 0.04;
                    result.description = 'Low blocker has small effect';
                }
                result.hasBlocker = true;
            }
        }
        
        return result;
    },
    
    rankToChar(rank) {
        const map = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T' };
        return map[rank] || String(rank);
    },
    
    generatePreflopExplanation(data) {
        const {
            hand, pot, toCall, potOdds, requiredEquity,
            rawEquity, impliedMultiplier, effectiveEquity,
            hasPosition, ev, isMixingSpot, shouldCall,
            villainRange, rangeKey, scenario
        } = data;
        
        const lines = [];
        
        // Pot odds line
        const potOddsPct = (potOdds * 100).toFixed(0);
        lines.push(`Pot: ${pot}bb. To call: ${toCall}bb. Pot odds: ${toCall}/(${pot}+${toCall}) = ${potOddsPct}%.`);
        
        // Villain range line
        if (villainRange) {
            lines.push(`Villain's ${scenario.type} range: ${villainRange.description}.`);
        }
        
        // Equity calculation
        const rawEqPct = (rawEquity * 100).toFixed(0);
        lines.push(`Your equity vs this range: ~${rawEqPct}%.`);
        
        // Implied odds if applicable
        if (impliedMultiplier > 1.05) {
            const impliedPct = ((impliedMultiplier - 1) * 100).toFixed(0);
            const adjEqPct = (effectiveEquity * 100).toFixed(0);
            let reasons = [];
            if (hand.isPair) reasons.push('set mining');
            if (hand.suited) reasons.push('flush potential');
            if (hasPosition) reasons.push('position');
            lines.push(`Implied odds (${reasons.join(', ')}): +${impliedPct}% → Effective equity: ~${adjEqPct}%.`);
        }
        
        // Decision
        const effectiveEqPct = (effectiveEquity * 100).toFixed(0);
        if (shouldCall) {
            lines.push(`Need ${potOddsPct}% to call. You have ${effectiveEqPct}%. Call is +EV.`);
        } else {
            lines.push(`Need ${potOddsPct}% to call. You have ${effectiveEqPct}%. Fold is correct.`);
        }
        
        // Mixing spot note
        if (isMixingSpot) {
            lines.push(`⚠️ This is close - GTO mixes here. Both actions are acceptable.`);
        }
        
        return lines.join(' ');
    },
    
    generateRiverExplanation(data) {
        const {
            hand, board, pot, toCall, potAfterBet, totalPotIfCall,
            betSize, potOdds, requiredEquity,
            handStrength, hasBlocker, blockerInfo,
            gtoBluffFreq, microBluffFreq,
            vsValueEquity, vsBluffEquity, totalEquity,
            ev, isMixingSpot, shouldCall, scenario
        } = data;
        
        const lines = [];
        
        // Pot and bet size
        const betSizePct = (betSize * 100).toFixed(0);
        lines.push(`Pot: ${pot}bb. Villain bets: ${toCall}bb (${betSizePct}% pot).`);
        lines.push(`Pot after bet: ${potAfterBet}bb. Call ${toCall}bb to win ${potAfterBet}bb.`);
        
        // Pot odds
        const reqEqPct = (requiredEquity * 100).toFixed(0);
        lines.push(`Required equity: ${toCall}/${totalPotIfCall.toFixed(0)} = ${reqEqPct}%.`);
        
        // Board texture
        const boardIssues = [];
        if (board.flushComplete) boardIssues.push('flush complete');
        if (board.straightComplete) boardIssues.push('straight possible');
        if (boardIssues.length > 0) {
            lines.push(`Board: ${boardIssues.join(', ')}.`);
        }
        
        // Bluff frequency analysis
        const gtoBluffPct = (gtoBluffFreq * 100).toFixed(0);
        const microBluffPct = (microBluffFreq * 100).toFixed(0);
        lines.push(`GTO bluff freq: ${gtoBluffPct}%. At microstakes: ~${microBluffPct}% (they under-bluff).`);
        
        // Equity breakdown
        const vsValuePct = (vsValueEquity * 100).toFixed(0);
        lines.push(`Your ${handStrength.replace('_', ' ')}: ${vsValuePct}% equity vs their value, 100% vs bluffs.`);
        
        // Blocker info
        if (hasBlocker && blockerInfo.description) {
            const bonusPct = (blockerInfo.bonus * 100).toFixed(0);
            lines.push(`Blocker: ${blockerInfo.description} (+${bonusPct}%).`);
        } else if (board.flushComplete) {
            lines.push(`No blocker: villain has all flush combos.`);
        }
        
        // Total equity
        const totalEqPct = (totalEquity * 100).toFixed(0);
        lines.push(`Total equity: (${microBluffPct}% × 100%) + (${(100-parseFloat(microBluffPct))}% × ${vsValuePct}%) = ~${totalEqPct}%.`);
        
        // Decision
        if (shouldCall) {
            lines.push(`Need ${reqEqPct}%. Have ${totalEqPct}%. Call.`);
        } else {
            lines.push(`Need ${reqEqPct}%. Have ${totalEqPct}%. Fold.`);
        }
        
        if (isMixingSpot) {
            lines.push(`⚠️ Close spot - mixing is acceptable.`);
        }
        
        return lines.join(' ');
    },
    
    categorizeHandStrength(scenario) {
        const str = scenario.handStrength?.toLowerCase() || '';
        if (str.includes('full house') || str.includes('quads')) return 'full_house';
        if (str.includes('nut flush') || str.includes('ace-high flush') || str.includes('a-high flush')) return 'nut_flush';
        if (str.includes('weak flush') || str.includes('9-high flush') || str.includes('8-high flush') || str.includes('low flush')) return 'weak_flush';
        if (str.includes('flush') && !str.includes('draw') && !str.includes('no')) return 'flush';
        if (str.includes('straight') && !str.includes('draw')) return 'straight';
        if (str.includes('set') || str.includes('three of')) return 'set';
        if (str.includes('two pair')) return 'two_pair';
        if (str.includes('overpair')) return 'overpair';
        if (str.includes('top pair')) return 'top_pair';
        if (str.includes('second pair')) return 'second_pair';
        return 'weak';
    },
    
    hasRelevantBlocker(hand, board) {
        if (!board || !board.flushComplete) return false;
        const flushSuit = board.flushSuit;
        return hand.suit1 === flushSuit || hand.suit2 === flushSuit;
    },
    
    hasPosition(heroPos, villainPos) {
        const positionOrder = ['UTG', 'UTG+1', 'UTG+2', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
        const heroIdx = positionOrder.indexOf(heroPos);
        const villainIdx = positionOrder.indexOf(villainPos);
        
        if (heroPos === 'BB' && villainPos === 'SB') return true;
        if (heroPos === 'SB' && villainPos === 'BB') return false;
        
        return heroIdx > villainIdx;
    }
};

// ============================================
// SCENARIO DEFINITIONS
// ============================================

const SCENARIOS = {
    '4bet': [
        // Scenario structure - minimal data only, everything else computed dynamically
        {
            type: '4bet',
            hand: ['A', 's', 'K', 's'],
            heroPosition: 'BTN',
            villainPosition: 'UTG',
            description: 'You 3-bet from BTN vs UTG open. UTG 4-bets to 22bb.',
            pot: '26',
            toCall: '14',
            stack: '100',
            dougPolkTip: 'AK is a slam dunk call. You block AA/KK and have great equity vs their range.'
        },
        {
            type: '4bet',
            hand: ['Q', 'd', 'J', 's'],
            heroPosition: 'BTN',
            villainPosition: 'UTG',
            description: 'You 3-bet from BTN vs UTG open. UTG 4-bets to 22bb.',
            pot: '26',
            toCall: '14',
            stack: '100',
            dougPolkTip: 'QJo vs a 4-bet from UTG? Insta-fold. You\'re dominated by everything in their range.'
        },
        {
            type: '4bet',
            hand: ['J', 'h', 'J', 'd'],
            heroPosition: 'BTN',
            villainPosition: 'UTG',
            description: 'You 3-bet from BTN vs UTG open. UTG 4-bets to 22bb.',
            pot: '26',
            toCall: '14',
            stack: '100',
            dougPolkTip: 'JJ vs UTG 4-bet is close. GTO mixes, but at micros they rarely 4-bet light from EP.'
        },
        {
            type: '4bet',
            hand: ['Q', 's', 'Q', 'c'],
            heroPosition: 'BTN',
            villainPosition: 'UTG',
            description: 'You 3-bet from BTN vs UTG open. UTG 4-bets to 22bb.',
            pot: '26',
            toCall: '14',
            stack: '100',
            dougPolkTip: 'QQ is always a call vs 4-bets. You\'re flipping at worst and dominating AK.'
        },
        {
            type: '4bet',
            hand: ['A', 'h', 'Q', 'h'],
            heroPosition: 'BTN',
            villainPosition: 'UTG',
            description: 'You 3-bet from BTN vs UTG open. UTG 4-bets to 22bb.',
            pot: '26',
            toCall: '14',
            stack: '100',
            dougPolkTip: 'AQs vs EP 4-bet is close in theory. At micros, they have it - fold and find a better spot.'
        },
        {
            type: '4bet',
            hand: ['T', 's', 'T', 'h'],
            heroPosition: 'BTN',
            villainPosition: 'CO',
            description: 'You 3-bet from BTN vs CO open. CO 4-bets to 20bb.',
            pot: '24',
            toCall: '12',
            stack: '100',
            dougPolkTip: 'TT vs CO 4-bet is a mixing spot. CO 4-bets slightly wider than EP but still tight.'
        },
        {
            type: '4bet',
            hand: ['J', 's', 'J', 'c'],
            heroPosition: 'BTN',
            villainPosition: 'CO',
            description: 'You 3-bet from BTN vs CO open. CO 4-bets to 20bb.',
            pot: '24',
            toCall: '12',
            stack: '100',
            dougPolkTip: 'JJ vs CO 4-bet is a call. CO includes more bluffs and lighter value than EP.'
        },
        {
            type: '4bet',
            hand: ['K', 'd', 'Q', 'd'],
            heroPosition: 'BTN',
            villainPosition: 'CO',
            description: 'You 3-bet from BTN vs CO open. CO 4-bets to 20bb.',
            pot: '24',
            toCall: '12',
            stack: '100',
            dougPolkTip: 'KQs looks pretty but it\'s crushed by their value range. Dominated by AK, behind all pairs.'
        },
        {
            type: '4bet',
            hand: ['A', 'h', 'Q', 's'],
            heroPosition: 'SB',
            villainPosition: 'BTN',
            description: 'You 3-bet from SB vs BTN open. BTN 4-bets to 18bb.',
            pot: '21',
            toCall: '10',
            stack: '100',
            dougPolkTip: 'BTN 4-bets way wider than EP. AQs is a clear call here.'
        },
        {
            type: '4bet',
            hand: ['T', 'h', 'T', 'd'],
            heroPosition: 'SB',
            villainPosition: 'BTN',
            description: 'You 3-bet from SB vs BTN open. BTN 4-bets to 18bb.',
            pot: '21',
            toCall: '10',
            stack: '100',
            dougPolkTip: 'TT vs BTN 4-bet is profitable. They have bluffs in their range and you have set mining odds.'
        },
        {
            type: '4bet',
            hand: ['9', 'h', '9', 'd'],
            heroPosition: 'BTN',
            villainPosition: 'UTG',
            description: 'You 3-bet from BTN vs UTG open. UTG 4-bets to 22bb.',
            pot: '26',
            toCall: '14',
            stack: '100',
            dougPolkTip: '99 vs EP 4-bet is a clear fold. You\'re crushed and don\'t have the implied odds to set mine.'
        },
        {
            type: '4bet',
            hand: ['K', 'h', 'K', 's'],
            heroPosition: 'BTN',
            villainPosition: 'UTG',
            description: 'You 3-bet from BTN vs UTG open. UTG 4-bets to 22bb.',
            pot: '26',
            toCall: '14',
            stack: '100',
            dougPolkTip: 'KK vs any 4-bet? Call or 5-bet jam. Never folding.'
        },
        {
            type: '4bet',
            hand: ['A', 'h', 'Q', 'c'],
            heroPosition: 'SB',
            villainPosition: 'BTN',
            description: 'You 3-bet from SB vs BTN open. BTN 4-bets to 18bb.',
            pot: '21',
            toCall: '10',
            stack: '100',
            dougPolkTip: 'AQo vs BTN 4-bet is marginal. Offsuit plays worse postflop than suited.'
        }
    ],
    
    '3bet': [
        {
            type: '3bet',
            hand: ['A', 's', 'Q', 's'],
            heroPosition: 'CO',
            villainPosition: 'BTN',
            description: 'You open from CO. BTN 3-bets to 9bb.',
            pot: '12',
            toCall: '6',
            stack: '100',
            dougPolkTip: 'AQs is too strong to fold. It\'s your bread and butter hand.'
        },
        {
            type: '3bet',
            hand: ['Q', 'h', 'J', 'h'],
            heroPosition: 'CO',
            villainPosition: 'BTN',
            description: 'You open from CO. BTN 3-bets to 9bb.',
            pot: '12',
            toCall: '6',
            stack: '100',
            dougPolkTip: 'QJs OOP is tough. You can\'t realize your equity well without position.'
        },
        {
            type: '3bet',
            hand: ['J', 's', 'J', 'd'],
            heroPosition: 'UTG',
            villainPosition: 'BTN',
            description: 'You open from UTG. BTN 3-bets to 10bb.',
            pot: '13',
            toCall: '7',
            stack: '100',
            dougPolkTip: 'JJ is the perfect example of a calling hand. You dominate their bluffs and flip vs value.'
        },
        {
            type: '3bet',
            hand: ['A', 'h', 'K', 'h'],
            heroPosition: 'UTG',
            villainPosition: 'BTN',
            description: 'You open from UTG. BTN 3-bets to 10bb.',
            pot: '13',
            toCall: '7',
            stack: '100',
            dougPolkTip: 'AKs is a 4-bet every time. Build the pot with your best hands.',
            // Special case: AK is a raise, not call
            forcedAction: 'raise'
        },
        {
            type: '3bet',
            hand: ['9', 'c', '9', 's'],
            heroPosition: 'UTG',
            villainPosition: 'BTN',
            description: 'You open from UTG. BTN 3-bets to 10bb.',
            pot: '13',
            toCall: '7',
            stack: '100',
            dougPolkTip: '99 OOP in 3-bet pots is a nightmare. Fold is fine, calling is fine. Just be consistent.'
        },
        {
            type: '3bet',
            hand: ['T', 'd', 'T', 'c'],
            heroPosition: 'BTN',
            villainPosition: 'BB',
            description: 'You open from BTN. BB 3-bets to 10bb.',
            pot: '12',
            toCall: '7',
            stack: '100',
            dougPolkTip: 'TT in position vs BB 3-bet is a slam dunk call. Their range is wide.'
        },
        {
            type: '3bet',
            hand: ['A', 's', 'K', 'c'],
            heroPosition: 'CO',
            villainPosition: 'BTN',
            description: 'You open from CO. BTN 3-bets to 9bb.',
            pot: '12',
            toCall: '6',
            stack: '100',
            dougPolkTip: 'AKo is a 4-bet. Sometimes you can flat to trap, but usually just build the pot.',
            forcedAction: 'raise'
        },
        {
            type: '3bet',
            hand: ['K', 'h', 'J', 'h'],
            heroPosition: 'CO',
            villainPosition: 'BTN',
            description: 'You open from CO. BTN 3-bets to 9bb.',
            pot: '12',
            toCall: '6',
            stack: '100',
            dougPolkTip: 'KJs OOP is marginal. It\'s dominated by AK and KQ too often.'
        },
        {
            type: '3bet',
            hand: ['K', 'h', 'J', 'h'],
            heroPosition: 'BTN',
            villainPosition: 'BB',
            description: 'You open from BTN. BB 3-bets to 10bb.',
            pot: '12',
            toCall: '7',
            stack: '100',
            dougPolkTip: 'KJs in position is a different story. You can realize your equity.'
        },
        {
            type: '3bet',
            hand: ['8', 's', '8', 'h'],
            heroPosition: 'BTN',
            villainPosition: 'BB',
            description: 'You open from BTN. BB 3-bets to 10bb.',
            pot: '12',
            toCall: '7',
            stack: '100',
            dougPolkTip: '88 in position is a call. You have implied odds and play well postflop.'
        },
        {
            type: '3bet',
            hand: ['Q', 'c', 'J', 'd'],
            heroPosition: 'BTN',
            villainPosition: 'BB',
            description: 'You open from BTN. BB 3-bets to 10bb.',
            pot: '12',
            toCall: '7',
            stack: '100',
            dougPolkTip: 'Offsuit broadways are trash in 3-bet pots. Fold and move on.'
        },
        {
            type: '3bet',
            hand: ['A', 'h', 'A', 'd'],
            heroPosition: 'UTG',
            villainPosition: 'BTN',
            description: 'You open from UTG. BTN 3-bets to 10bb.',
            pot: '13',
            toCall: '7',
            stack: '100',
            dougPolkTip: 'Never slowplay AA preflop. 4-bet and stack them.',
            forcedAction: 'raise'
        },
        {
            type: '3bet',
            hand: ['7', 's', '7', 'h'],
            heroPosition: 'BTN',
            villainPosition: 'SB',
            description: 'You open from BTN. SB 3-bets to 10bb.',
            pot: '13',
            toCall: '7',
            stack: '100',
            dougPolkTip: '77 in position is a call. You\'re set mining with implied odds.'
        },
        {
            type: '3bet',
            hand: ['Q', 'h', 'J', 'h'],
            handName: 'QJs',
            heroPosition: 'BTN',
            villainPosition: 'BB',
            description: 'You open from BTN. BB 3-bets to 10bb.',
            pot: '12',
            toCall: '7',
            stack: '100',
            correctAnswers: ['call'],
            mixingAnswers: [],
            explanation: 'QJs has ~42% equity with position vs wide BB range. Call.',
            dougPolkTip: 'QJs in position vs BB is profitable. Their range is wide and you have playability.'
        }
    ],
    
    'river': [
        // River scenarios - minimal data, explanations computed dynamically
        {
            type: 'river',
            hand: ['A', 'c', 'J', 'c'],
            heroPosition: 'CO',
            villainPosition: 'BTN',
            board: [['A', 'd'], ['J', 'd'], ['6', 'c'], ['Q', 's'], ['9', 'd']],
            handStrength: 'Two Pair (Aces and Jacks)',
            description: 'You bet flop and turn with top two pair. River brings 4th diamond. Villain shoves 2x pot.',
            pot: '50',
            toCall: '100',
            stack: '100',
            dougPolkTip: 'Two pair on a 4-flush board vs a shove? They have it. Fold and save your stack.'
        },
        {
            type: 'river',
            hand: ['K', 'c', 'J', 'c'],
            heroPosition: 'CO',
            villainPosition: 'SB',
            board: [['T', 's'], ['7', 'c'], ['3', 'h'], ['J', 's'], ['6', 's']],
            handStrength: 'Top Pair (Jacks)',
            description: 'You c-bet flop, bet turn with top pair. River completes flush. Villain shoves 2x pot.',
            pot: '40',
            toCall: '80',
            stack: '80',
            dougPolkTip: 'Top pair vs a river shove on a flush board is a snap fold. They\'re not bluffing.'
        },
        {
            type: 'river',
            hand: ['9', 'd', '9', 'c'],
            heroPosition: 'CO',
            villainPosition: 'BTN',
            board: [['9', 's'], ['7', 's'], ['2', 's'], ['K', 'h'], ['3', 's']],
            handStrength: 'Set of Nines - NO spade blocker',
            description: 'You bet flop and turn with a set. River brings 4th spade. You have NO spade. Villain shoves 1.5x pot.',
            pot: '55',
            toCall: '80',
            stack: '80',
            dougPolkTip: 'Set without a blocker on a 4-flush board is a FOLD. This is a big leak if you\'re calling these.'
        },
        {
            type: 'river',
            hand: ['9', 's', '9', 'h'],
            heroPosition: 'CO',
            villainPosition: 'BTN',
            board: [['9', 'd'], ['7', 's'], ['2', 's'], ['K', 's'], ['3', 's']],
            handStrength: '9-high flush (weak flush)',
            description: 'You bet flop and turn with a set. River brings 4th spade. Your 9♠ makes a 9-high flush. Villain shoves 1.5x pot.',
            pot: '55',
            toCall: '80',
            stack: '80',
            dougPolkTip: 'You have a flush but it\'s 9-high - you lose to A/Q/J/T high. At micros this is close. They usually have better.'
        },
        {
            type: 'river',
            hand: ['Q', 'd', 'Q', 'c'],
            heroPosition: 'CO',
            villainPosition: 'BB',
            board: [['J', 'h'], ['8', 'h'], ['3', 'd'], ['5', 'h'], ['2', 'h']],
            handStrength: 'Overpair (Queens) - No heart blocker',
            description: 'You c-bet flop and turn. River brings 4th heart. You have NO heart. Villain check-raises all-in 2x pot.',
            pot: '45',
            toCall: '90',
            stack: '90',
            dougPolkTip: 'Overpair with no blocker vs a check-raise on 4-flush? They have the flush. Period.'
        },
        {
            type: 'river',
            hand: ['K', 's', 'K', 'h'],
            heroPosition: 'BTN',
            villainPosition: 'BB',
            board: [['T', 'c'], ['7', 's'], ['2', 'd'], ['4', 'h'], ['A', 'c']],
            handStrength: 'Overpair (Kings) - Ace river',
            description: 'You bet flop and turn. River brings an Ace. Villain check-raises all-in 1.5x pot.',
            pot: '40',
            toCall: '60',
            stack: '60',
            dougPolkTip: 'When the Ace comes and they check-raise, they have an Ace. At micros, this is never a bluff.'
        },
        {
            type: 'river',
            hand: ['8', 'c', '8', 's'],
            heroPosition: 'BTN',
            villainPosition: 'SB',
            board: [['8', 'h'], ['6', 'h'], ['2', 'h'], ['6', 'd'], ['A', 'h']],
            handStrength: 'Full House (8s full of 6s)',
            description: 'You bet all streets. River brings 4th heart. Villain raises all-in.',
            pot: '60',
            toCall: '40',
            stack: '40',
            dougPolkTip: 'Full house beats flushes. This is the easiest call of your life.'
        },
        {
            type: 'river',
            hand: ['J', 'h', 'J', 'd'],
            heroPosition: 'BTN',
            villainPosition: 'BB',
            board: [['K', 'c'], ['9', 'h'], ['5', 's'], ['3', 'd'], ['T', 'c']],
            handStrength: 'Second Pair (Jacks)',
            description: 'You c-bet flop, check turn. River check, villain bets 75% pot.',
            pot: '20',
            toCall: '15',
            stack: '85',
            dougPolkTip: 'This isn\'t a shove or overbet. Against a normal bet, second pair is a call.'
        },
        {
            type: 'river',
            hand: ['A', 'd', 'Q', 'd'],
            heroPosition: 'CO',
            villainPosition: 'BTN',
            board: [['A', 'c'], ['Q', 'h'], ['7', 's'], ['K', 'c'], ['J', 'c']],
            handStrength: 'Two Pair on scary board',
            description: 'You bet flop with top two. Turn brings K, check. River Jc completes flush AND straight. Villain bets pot.',
            pot: '30',
            toCall: '30',
            stack: '70',
            dougPolkTip: 'When both flush and straight complete, two pair is in bad shape. Fold.'
        },
        {
            type: 'river',
            hand: ['A', 'h', 'K', 'h'],
            heroPosition: 'CO',
            villainPosition: 'BB',
            board: [['A', 's'], ['9', 'c'], ['4', 'd'], ['7', 's'], ['2', 's']],
            handStrength: 'Top Pair Top Kicker - 3 flush',
            description: 'You c-bet flop and turn with TPTK. River brings 3rd spade. Villain donk shoves 2x pot.',
            pot: '35',
            toCall: '70',
            stack: '70',
            dougPolkTip: 'TPTK vs a donk shove on a flush board? They have it. Fold.'
        }
    ]
};

// ============================================
// QUIZ APPLICATION
// ============================================

class LeakQuizApp {
    constructor() {
        this.currentMode = null;
        this.questions = [];
        this.currentIndex = 0;
        this.score = { correct: 0, wrong: 0, acceptable: 0 };
        this.streak = 0;
        this.bestStreak = 0;
        this.answers = [];
        this.leakTracker = {
            '4bet_call_too_loose': 0,
            '4bet_fold_too_tight': 0,
            '3bet_call_too_loose': 0,
            '3bet_fold_too_tight': 0,
            'river_call_too_loose': 0,
            'river_fold_too_tight': 0
        };
        
        this.initElements();
        this.setupHistoryHandling();
    }
    
    initElements() {
        this.modeSelector = document.getElementById('modeSelector');
        this.quizContainer = document.getElementById('quizContainer');
        this.resultsScreen = document.getElementById('resultsScreen');
        this.scenarioCard = document.getElementById('scenarioCard');
        this.feedbackCard = document.getElementById('feedbackCard');
        this.actionButtons = document.getElementById('actionButtons');
        this.raiseBtn = document.getElementById('raiseBtn');
    }
    
    // Handle browser back/forward buttons
    setupHistoryHandling() {
        window.addEventListener('popstate', (event) => {
            if (event.state) {
                if (event.state.screen === 'menu') {
                    this.showMenuScreen();
                } else if (event.state.screen === 'quiz') {
                    this.restoreQuizState(event.state);
                } else if (event.state.screen === 'results') {
                    this.showResultsFromHistory(event.state);
                }
            } else {
                this.showMenuScreen();
            }
        });
        
        // Set initial state
        if (!history.state) {
            history.replaceState({ screen: 'menu' }, '', '');
        }
    }
    
    showMenuScreen() {
        this.modeSelector.classList.remove('hidden');
        this.quizContainer.classList.add('hidden');
        this.resultsScreen.classList.add('hidden');
    }
    
    restoreQuizState(state) {
        this.currentMode = state.mode;
        this.questions = state.questions;
        this.currentIndex = state.currentIndex;
        this.score = state.score;
        this.answers = state.answers;
        
        this.modeSelector.classList.add('hidden');
        this.quizContainer.classList.remove('hidden');
        this.resultsScreen.classList.add('hidden');
        
        this.initProgressBar();
        this.updateProgressFromAnswers();
        this.showQuestion();
    }
    
    showResultsFromHistory(state) {
        this.score = state.score;
        this.bestStreak = state.bestStreak;
        this.leakTracker = state.leakTracker;
        this.questions = state.questions;
        
        this.quizContainer.classList.add('hidden');
        this.resultsScreen.classList.remove('hidden');
        this.modeSelector.classList.add('hidden');
        
        this.displayResults();
    }
    
    saveQuizState() {
        const state = {
            screen: 'quiz',
            mode: this.currentMode,
            questions: this.questions,
            currentIndex: this.currentIndex,
            score: { ...this.score },
            answers: [...this.answers]
        };
        history.pushState(state, '', `#quiz-${this.currentMode}-q${this.currentIndex + 1}`);
    }
    
    startQuiz(mode) {
        this.currentMode = mode;
        this.currentIndex = 0;
        this.score = { correct: 0, wrong: 0, acceptable: 0 };
        this.streak = 0;
        this.bestStreak = 0;
        this.answers = [];
        this.leakTracker = {
            '4bet_call_too_loose': 0,
            '4bet_fold_too_tight': 0,
            '3bet_call_too_loose': 0,
            '3bet_fold_too_tight': 0,
            'river_call_too_loose': 0,
            'river_fold_too_tight': 0
        };
        
        // Select questions based on mode
        if (mode === 'mixed') {
            this.questions = this.shuffleArray([
                ...SCENARIOS['4bet'],
                ...SCENARIOS['3bet'],
                ...SCENARIOS['river']
            ]).slice(0, 15);
        } else {
            this.questions = this.shuffleArray([...SCENARIOS[mode]]).slice(0, 10);
        }
        
        document.getElementById('totalQ').textContent = this.questions.length;
        
        this.modeSelector.classList.add('hidden');
        this.quizContainer.classList.remove('hidden');
        this.resultsScreen.classList.add('hidden');
        
        this.initProgressBar();
        this.saveQuizState();
        this.showQuestion();
    }
    
    initProgressBar() {
        const progressBar = document.getElementById('progressBar');
        progressBar.innerHTML = '';
        
        for (let i = 0; i < this.questions.length; i++) {
            const segment = document.createElement('div');
            segment.className = 'progress-segment flex-1 h-full rounded-full bg-gray-700';
            segment.id = `progress-${i}`;
            progressBar.appendChild(segment);
        }
    }
    
    updateProgressFromAnswers() {
        this.answers.forEach((answer, i) => {
            const segment = document.getElementById(`progress-${i}`);
            if (answer.isCorrect) {
                segment.className = 'progress-segment flex-1 h-full rounded-full bg-primary';
            } else if (answer.isAcceptable) {
                segment.className = 'progress-segment flex-1 h-full rounded-full bg-accent';
            } else {
                segment.className = 'progress-segment flex-1 h-full rounded-full bg-danger';
            }
        });
    }
    
    showQuestion() {
        const q = this.questions[this.currentIndex];
        
        // Dynamic calculation
        let analysis;
        if (q.type === 'river') {
            analysis = DecisionEngine.evaluateRiverSpot(q);
        } else {
            analysis = DecisionEngine.evaluatePreflopSpot(q);
        }
        
        // Store analysis for feedback
        q._analysis = analysis;
        
        document.getElementById('currentQ').textContent = this.currentIndex + 1;
        document.getElementById('correctCount').textContent = this.score.correct;
        document.getElementById('acceptableCount').textContent = this.score.acceptable;
        document.getElementById('wrongCount').textContent = this.score.wrong;
        
        const streakDisplay = document.getElementById('streakDisplay');
        if (this.streak >= 3) {
            streakDisplay.classList.remove('hidden');
            document.getElementById('streakCount').textContent = this.streak;
        } else {
            streakDisplay.classList.add('hidden');
        }
        
        const typeEl = document.getElementById('scenarioType');
        if (q.type === '4bet') {
            typeEl.textContent = 'FACING 4-BET';
            typeEl.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-danger/20 text-danger';
        } else if (q.type === '3bet') {
            typeEl.textContent = 'FACING 3-BET';
            typeEl.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-accent/20 text-accent';
        } else {
            typeEl.textContent = 'RIVER DECISION';
            typeEl.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-400';
        }
        
        document.getElementById('positionBadge').textContent = `${q.heroPosition} vs ${q.villainPosition}`;
        document.getElementById('heroHand').innerHTML = this.formatHand(q.hand);
        document.getElementById('scenarioDesc').textContent = q.description;
        
        const boardSection = document.getElementById('boardSection');
        if (q.type === 'river' && q.board) {
            boardSection.classList.remove('hidden');
            document.getElementById('boardCards').innerHTML = this.formatBoard(q.board);
        } else {
            boardSection.classList.add('hidden');
        }
        
        document.getElementById('potSize').textContent = q.pot + 'bb';
        document.getElementById('toCall').textContent = q.toCall + 'bb';
        document.getElementById('stackSize').textContent = q.stack + 'bb';
        
        if (q.type === '4bet' || q.type === 'river') {
            this.raiseBtn.classList.add('hidden');
            this.actionButtons.className = 'grid grid-cols-2 gap-3';
        } else {
            this.raiseBtn.classList.remove('hidden');
            this.actionButtons.className = 'grid grid-cols-2 sm:grid-cols-3 gap-3';
        }
        
        this.scenarioCard.classList.remove('hidden');
        this.feedbackCard.classList.add('hidden');
        this.enableButtons();
        
        this.scenarioCard.classList.remove('animate-in');
        void this.scenarioCard.offsetWidth;
        this.scenarioCard.classList.add('animate-in');
    }
    
    formatHand(hand) {
        const card1 = `<span class="suit-${hand[1]}">${hand[0]}${this.getSuitSymbol(hand[1])}</span>`;
        const card2 = `<span class="suit-${hand[3]}">${hand[2]}${this.getSuitSymbol(hand[3])}</span>`;
        return `${card1} ${card2}`;
    }
    
    formatBoard(board) {
        return board.map(card => {
            return `<span class="suit-${card[1]}">${card[0]}${this.getSuitSymbol(card[1])}</span>`;
        }).join(' ');
    }
    
    getSuitSymbol(suit) {
        const symbols = { 's': '♠', 'h': '♥', 'd': '♦', 'c': '♣' };
        return symbols[suit] || suit;
    }
    
    submitAnswer(answer) {
        const q = this.questions[this.currentIndex];
        const analysis = q._analysis;
        
        // Determine correct and mixing answers from dynamic analysis
        let correctAnswers, mixingAnswers;
        
        // Check for forced action (AK, AA should always raise vs 3-bet)
        if (q.forcedAction) {
            correctAnswers = [q.forcedAction];
            mixingAnswers = [];
        } else if (analysis) {
            // Derive from dynamic calculation
            const shouldCall = analysis.shouldCall;
            const isMixing = analysis.isMixingSpot;
            
            if (shouldCall) {
                correctAnswers = ['call'];
                mixingAnswers = isMixing ? ['fold'] : [];
            } else {
                correctAnswers = ['fold'];
                mixingAnswers = isMixing ? ['call'] : [];
            }
        } else {
            // Fallback (should not happen)
            correctAnswers = ['fold'];
            mixingAnswers = [];
        }
        
        // Store computed answers for feedback display
        q._correctAnswers = correctAnswers;
        q._mixingAnswers = mixingAnswers;
        
        // Check if answer is correct, acceptable (mixing), or wrong
        const isCorrect = correctAnswers.includes(answer);
        const isAcceptable = !isCorrect && mixingAnswers.includes(answer);
        const isWrong = !isCorrect && !isAcceptable;
        
        // Track leaks only for wrong answers
        if (isWrong) {
            this.trackLeak(q, answer, correctAnswers);
        }
        
        // Update score and streak
        if (isCorrect) {
            this.score.correct++;
            this.streak++;
            if (this.streak > this.bestStreak) {
                this.bestStreak = this.streak;
            }
        } else if (isAcceptable) {
            this.score.acceptable++;
            // Don't break streak for acceptable mixing answers
        } else {
            this.score.wrong++;
            this.streak = 0;
        }
        
        this.answers.push({
            question: q,
            answer: answer,
            isCorrect,
            isAcceptable,
            correctAnswers,
            mixingAnswers
        });
        
        // Update progress bar
        const segment = document.getElementById(`progress-${this.currentIndex}`);
        if (isCorrect) {
            segment.className = 'progress-segment flex-1 h-full rounded-full bg-primary';
        } else if (isAcceptable) {
            segment.className = 'progress-segment flex-1 h-full rounded-full bg-accent';
        } else {
            segment.className = 'progress-segment flex-1 h-full rounded-full bg-danger';
        }
        
        this.disableButtons();
        this.showFeedback(q, answer, isCorrect, isAcceptable, correctAnswers, mixingAnswers);
        this.saveQuizState();
    }
    
    trackLeak(q, answer, correctAnswers) {
        if (q.type === '4bet') {
            if (correctAnswers.includes('fold') && answer === 'call') {
                this.leakTracker['4bet_call_too_loose']++;
            } else if (correctAnswers.includes('call') && answer === 'fold') {
                this.leakTracker['4bet_fold_too_tight']++;
            }
        } else if (q.type === '3bet') {
            if (correctAnswers.includes('fold') && (answer === 'call' || answer === 'raise')) {
                this.leakTracker['3bet_call_too_loose']++;
            } else if ((correctAnswers.includes('call') || correctAnswers.includes('raise')) && answer === 'fold') {
                this.leakTracker['3bet_fold_too_tight']++;
            }
        } else if (q.type === 'river') {
            if (correctAnswers.includes('fold') && answer === 'call') {
                this.leakTracker['river_call_too_loose']++;
            } else if (correctAnswers.includes('call') && answer === 'fold') {
                this.leakTracker['river_fold_too_tight']++;
            }
        }
    }
    
    showFeedback(q, answer, isCorrect, isAcceptable, correctAnswers, mixingAnswers) {
        const feedbackIcon = document.getElementById('feedbackIcon');
        const feedbackTitle = document.getElementById('feedbackTitle');
        const feedbackSubtitle = document.getElementById('feedbackSubtitle');
        const feedbackExplanation = document.getElementById('feedbackExplanation');
        const gtoRangeText = document.getElementById('gtoRangeText');
        
        if (isCorrect) {
            feedbackIcon.textContent = '✓';
            feedbackIcon.className = 'w-12 h-12 rounded-full flex items-center justify-center text-2xl bg-primary/20 text-primary';
            feedbackTitle.textContent = 'Correct!';
            feedbackTitle.className = 'font-bold text-xl text-primary';
            feedbackSubtitle.textContent = 'Optimal play';
        } else if (isAcceptable) {
            feedbackIcon.textContent = '≈';
            feedbackIcon.className = 'w-12 h-12 rounded-full flex items-center justify-center text-2xl bg-accent/20 text-accent';
            feedbackTitle.textContent = 'Acceptable!';
            feedbackTitle.className = 'font-bold text-xl text-accent';
            feedbackSubtitle.textContent = `Mixing spot - ${correctAnswers[0].toUpperCase()} is slightly better`;
        } else {
            feedbackIcon.textContent = '✗';
            feedbackIcon.className = 'w-12 h-12 rounded-full flex items-center justify-center text-2xl bg-danger/20 text-danger';
            feedbackTitle.textContent = 'Incorrect';
            feedbackTitle.className = 'font-bold text-xl text-danger';
            feedbackSubtitle.textContent = `Correct: ${correctAnswers[0].toUpperCase()}`;
        }
        
        // Use the dynamically generated explanation from analysis
        const analysis = q._analysis;
        let fullExplanation = '';
        
        if (analysis && analysis.explanation) {
            // Use the dynamically generated explanation
            fullExplanation = analysis.explanation;
        } else {
            // Fallback to manually building explanation (shouldn't happen)
            fullExplanation = 'Analysis not available.';
        }
        
        // Add Doug Polk tip
        if (q.dougPolkTip) {
            fullExplanation += `\n\n🎯 Doug Polk says: "${q.dougPolkTip}"`;
        }
        
        feedbackExplanation.textContent = fullExplanation;
        feedbackExplanation.style.whiteSpace = 'pre-line';
        
        // GTO Range info
        let rangeInfo = `Correct: ${correctAnswers.join(' or ').toUpperCase()}`;
        if (mixingAnswers && mixingAnswers.length > 0) {
            rangeInfo += ` | Also OK (mixing): ${mixingAnswers.join(', ').toUpperCase()}`;
        }
        gtoRangeText.textContent = rangeInfo;
        
        this.scenarioCard.classList.add('hidden');
        this.feedbackCard.classList.remove('hidden');
        
        this.feedbackCard.classList.remove('animate-in');
        void this.feedbackCard.offsetWidth;
        this.feedbackCard.classList.add('animate-in');
    }
    
    nextQuestion() {
        this.currentIndex++;
        
        if (this.currentIndex >= this.questions.length) {
            this.showResults();
        } else {
            this.saveQuizState();
            this.showQuestion();
        }
    }
    
    showResults() {
        this.quizContainer.classList.add('hidden');
        this.resultsScreen.classList.remove('hidden');
        
        // Save to history
        history.pushState({
            screen: 'results',
            score: this.score,
            bestStreak: this.bestStreak,
            leakTracker: this.leakTracker,
            questions: this.questions
        }, '', '#results');
        
        this.displayResults();
    }
    
    displayResults() {
        const total = this.questions.length;
        const correctAndAcceptable = this.score.correct + this.score.acceptable;
        const accuracy = total > 0 ? Math.round((correctAndAcceptable / total) * 100) : 0;
        
        const emoji = document.getElementById('resultsEmoji');
        const title = document.getElementById('resultsTitle');
        const subtitle = document.getElementById('resultsSubtitle');
        
        if (accuracy >= 90) {
            emoji.textContent = '🏆';
            title.textContent = 'Outstanding!';
            subtitle.textContent = 'Doug Polk would be proud!';
        } else if (accuracy >= 70) {
            emoji.textContent = '🎯';
            title.textContent = 'Great Job!';
            subtitle.textContent = 'You\'re crushing it.';
        } else if (accuracy >= 50) {
            emoji.textContent = '📈';
            title.textContent = 'Getting There!';
            subtitle.textContent = 'Keep grinding.';
        } else {
            emoji.textContent = '📚';
            title.textContent = 'Keep Studying!';
            subtitle.textContent = 'Review the math carefully.';
        }
        
        document.getElementById('finalScore').textContent = `${accuracy}%`;
        document.getElementById('finalCorrect').textContent = this.score.correct + (this.score.acceptable > 0 ? `+${this.score.acceptable}` : '');
        document.getElementById('finalStreak').textContent = this.bestStreak;
        
        this.showLeakAnalysis();
    }
    
    showLeakAnalysis() {
        const leakList = document.getElementById('leakList');
        leakList.innerHTML = '';
        
        const leakMessages = {
            '4bet_call_too_loose': { text: 'Calling 4-bets too loose', icon: '🔴', severity: 'high' },
            '4bet_fold_too_tight': { text: 'Folding to 4-bets too tight', icon: '🟡', severity: 'medium' },
            '3bet_call_too_loose': { text: 'Calling 3-bets too loose', icon: '🔴', severity: 'high' },
            '3bet_fold_too_tight': { text: 'Folding to 3-bets too tight', icon: '🟡', severity: 'medium' },
            'river_call_too_loose': { text: 'Hero calling rivers too loose', icon: '🔴', severity: 'high' },
            'river_fold_too_tight': { text: 'Folding rivers too tight', icon: '🟡', severity: 'medium' }
        };
        
        let hasLeaks = false;
        
        for (const [leak, count] of Object.entries(this.leakTracker)) {
            if (count > 0) {
                hasLeaks = true;
                const info = leakMessages[leak];
                const item = document.createElement('div');
                item.className = 'flex items-center justify-between p-2 rounded bg-card-dark';
                item.innerHTML = `
                    <span class="flex items-center gap-2">
                        <span>${info.icon}</span>
                        <span class="${info.severity === 'high' ? 'text-danger' : 'text-accent'}">${info.text}</span>
                    </span>
                    <span class="font-mono text-gray-400">${count}x</span>
                `;
                leakList.appendChild(item);
            }
        }
        
        if (!hasLeaks) {
            leakList.innerHTML = '<div class="text-primary text-center">No significant leaks detected! 🎉</div>';
        }
        
        // Add note about acceptable answers
        if (this.score.acceptable > 0) {
            const note = document.createElement('div');
            note.className = 'mt-3 p-2 rounded bg-accent/10 text-accent text-sm';
            note.textContent = `Note: ${this.score.acceptable} answer(s) were acceptable mixing spots. Both actions are fine in those situations.`;
            leakList.appendChild(note);
        }
    }
    
    restartQuiz() {
        this.startQuiz(this.currentMode);
    }
    
    endQuiz() {
        history.pushState({ screen: 'menu' }, '', '#');
        this.showMenuScreen();
    }
    
    enableButtons() {
        document.querySelectorAll('#actionButtons button').forEach(btn => {
            btn.disabled = false;
            btn.classList.remove('opacity-50', 'cursor-not-allowed');
        });
    }
    
    disableButtons() {
        document.querySelectorAll('#actionButtons button').forEach(btn => {
            btn.disabled = true;
            btn.classList.add('opacity-50', 'cursor-not-allowed');
        });
    }
    
    shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }
}

// Initialize app
const app = new LeakQuizApp();
