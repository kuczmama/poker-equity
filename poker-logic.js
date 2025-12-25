// Poker hand parsing and evaluation logic

class PokerHand {
    constructor(cards) {
        this.cards = cards;
        this.suited = false;
        this.paired = false;
        this.highCard = null;
        this.lowCard = null;
        this.parseHand();
    }

    parseHand() {
        const input = this.cards.trim().replace(/\s/g, '').toUpperCase();
        
        // Check for specific card format (e.g. "AsKh", "Td2c")
        // Regex: Rank+Suit+Rank+Suit
        const specificCardRegex = /^([AKQJT98765432][SHDC])([AKQJT98765432][SHDC])$/;
        const match = input.match(specificCardRegex);

        if (match) {
            // Specific cards
            const c1 = match[1];
            const c2 = match[2];
            
            const r1 = this.parseCard(c1[0]);
            const s1 = c1[1].toLowerCase();
            const r2 = this.parseCard(c2[0]);
            const s2 = c2[1].toLowerCase();

            this.specificCards = [
                { rank: r1, suit: s1 },
                { rank: r2, suit: s2 }
            ];

            this.highCard = Math.max(r1, r2);
            this.lowCard = Math.min(r1, r2);
            this.paired = r1 === r2;
            this.suited = s1 === s2;
            return;
        }

        if (input.length === 2) {
            // Pocket pair (e.g., "22", "AA")
            this.paired = true;
            this.highCard = this.parseCard(input[0]);
            this.lowCard = this.highCard;
        } else if (input.length === 3) {
            // Two cards with suit indicator (e.g., "AQs", "AKo")
            const high = this.parseCard(input[0]);
            const low = this.parseCard(input[1]);
            this.suited = input[2] === 'S';
            
            this.highCard = Math.max(high, low);
            this.lowCard = Math.min(high, low);
            this.paired = this.highCard === this.lowCard;
            
            // Validate: pocket pairs cannot be suited
            if (this.paired && this.suited) {
                throw new Error(`Invalid hand: ${input}. Pocket pairs cannot be suited (use ${input[0]}${input[1]} instead)`);
            }
        } else if (input.length === 4) {
            // Two cards with suit indicator (e.g., "AKs", "AQs") - alternative format
            const high = this.parseCard(input[0]);
            const low = this.parseCard(input[1]);
            this.suited = input[3] === 'S';
            
            this.highCard = Math.max(high, low);
            this.lowCard = Math.min(high, low);
            this.paired = this.highCard === this.lowCard;
            
            // Validate: pocket pairs cannot be suited
            if (this.paired && this.suited) {
                throw new Error(`Invalid hand: ${input}. Pocket pairs cannot be suited (use ${input[0]}${input[1]} instead)`);
            }
        } else {
            throw new Error(`Invalid hand format: ${input}. Use format like: 22, AKo, AKs, AQs, or specific cards AsKh`);
        }
    }

    parseCard(card) {
        const cardMap = {
            'A': 14, 'K': 13, 'Q': 12, 'J': 11, 'T': 10,
            '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2
        };
        
        if (cardMap[card] === undefined) {
            throw new Error(`Invalid card: ${card}`);
        }
        
        return cardMap[card];
    }

    getHandType() {
        if (this.paired) {
            return `Pocket ${this.getCardName(this.highCard)}s`;
        } else {
            const high = this.getCardName(this.highCard);
            const low = this.getCardName(this.lowCard);
            const suit = this.suited ? 'suited' : 'offsuit';
            return `${high}${low} ${suit}`;
        }
    }

    getCardName(value) {
        const cardNames = {
            14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T',
            9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2'
        };
        return cardNames[value];
    }

    // Generate all possible card combinations for this hand
    getAllPossibleCards() {
        if (this.specificCards) {
            return [this.specificCards];
        }

        const suits = ['h', 'd', 'c', 's']; // hearts, diamonds, clubs, spades
        const combinations = [];

        if (this.paired) {
            // For pocket pairs, generate all suit combinations
            for (let i = 0; i < suits.length; i++) {
                for (let j = i + 1; j < suits.length; j++) {
                    combinations.push([
                        { rank: this.highCard, suit: suits[i] },
                        { rank: this.highCard, suit: suits[j] }
                    ]);
                }
            }
        } else {
            // For non-paired hands
            if (this.suited) {
                // All cards of the same suit
                for (const suit of suits) {
                    combinations.push([
                        { rank: this.highCard, suit: suit },
                        { rank: this.lowCard, suit: suit }
                    ]);
                }
            } else {
                // All offsuit combinations
                for (const suit1 of suits) {
                    for (const suit2 of suits) {
                        if (suit1 !== suit2) {
                            combinations.push([
                                { rank: this.highCard, suit: suit1 },
                                { rank: this.lowCard, suit: suit2 }
                            ]);
                        }
                    }
                }
            }
        }

        return combinations;
    }
}

// Range parser for standard poker notation
class RangeParser {
    constructor() {
        this.cardMap = {
            'A': 14, 'K': 13, 'Q': 12, 'J': 11, 'T': 10,
            '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2
        };
        this.cardNames = {
            14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T',
            9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2'
        };
    }

    parseRange(rangeString) {
        if (!rangeString || !rangeString.trim()) {
            throw new Error('Range string cannot be empty');
        }

        const tokens = rangeString.split(',').map(t => t.trim()).filter(t => t.length > 0);
        const hands = new Set();
        const handStrings = new Set();

        for (const token of tokens) {
            const tokenHands = this.parseToken(token);
            for (const hand of tokenHands) {
                const handKey = this.getHandKey(hand);
                if (!handStrings.has(handKey)) {
                    hands.add(hand);
                    handStrings.add(handKey);
                }
            }
        }

        return Array.from(hands);
    }

    parseToken(token) {
        const upperToken = token.toUpperCase();
        const hands = [];

        if (upperToken.endsWith('+')) {
            // This is a range expansion
            const base = upperToken.slice(0, -1);
            hands.push(...this.expandRange(base));
        } else {
            // Single hand
            try {
                const hand = new PokerHand(upperToken);
                hands.push(hand);
            } catch (error) {
                throw new Error(`Invalid hand in range: ${token}. ${error.message}`);
            }
        }

        return hands;
    }

    expandRange(base) {
        const hands = [];

        if (base.length === 2 && base[0] === base[1]) {
            // Pocket pair range: 55+ means 55 through AA
            const startRank = this.cardMap[base[0]];
            if (!startRank) {
                throw new Error(`Invalid pair: ${base}`);
            }
            for (let rank = startRank; rank <= 14; rank++) {
                const cardName = this.cardNames[rank];
                try {
                    hands.push(new PokerHand(cardName + cardName));
                } catch (error) {
                    throw new Error(`Error expanding pair range ${base}: ${error.message}`);
                }
            }
        } else if (base.length === 3) {
            // Two-card hand with suit indicator
            const high = this.cardMap[base[0]];
            const low = this.cardMap[base[1]];
            const suitIndicator = base[2];

            if (!high || !low) {
                throw new Error(`Invalid cards in range: ${base}`);
            }

            if (suitIndicator === 'S') {
                // Suited range: A5s+ means A5s, A6s, ..., AKs
                hands.push(...this.expandSuitedRange(high, low));
            } else if (suitIndicator === 'O') {
                // Offsuit range: A5o+ means A5o, A6o, ..., AKo
                hands.push(...this.expandOffsuitRange(high, low));
            } else {
                throw new Error(`Invalid suit indicator in range: ${base}. Use 's' for suited or 'o' for offsuit`);
            }
        } else if (base.length === 2 && base[0] !== base[1]) {
            // Two-card hand without suit indicator: AT+ means offsuit hands from AT to AK
            // This allows combining with suited ranges like "A5s+,AT+" without duplication
            const high = this.cardMap[base[0]];
            const low = this.cardMap[base[1]];

            if (!high || !low) {
                throw new Error(`Invalid cards in range: ${base}`);
            }

            // Default to offsuit when no suit indicator (standard practice)
            hands.push(...this.expandOffsuitRange(high, low));
        } else {
            throw new Error(`Invalid range format: ${base}`);
        }

        return hands;
    }

    expandSuitedRange(highRank, lowRank) {
        const hands = [];
        
        if (highRank === lowRank) {
            throw new Error('Pocket pairs cannot be suited');
        }

        // Normalize so high rank is always first
        const actualHigh = Math.max(highRank, lowRank);
        const actualLow = Math.min(highRank, lowRank);

        // For suited ranges like A5s+, expand from the low card up to one below the high card
        // A5s+ means: A5s, A6s, A7s, A8s, A9s, ATs, AJs, AQs, AKs
        // So we expand from actualLow (5) up to actualHigh-1 (13, which is K)
        const startRank = actualLow;
        const endRank = actualHigh - 1;

        for (let rank = startRank; rank <= endRank; rank++) {
            const highCard = this.cardNames[actualHigh];
            const lowCard = this.cardNames[rank];
            try {
                hands.push(new PokerHand(highCard + lowCard + 's'));
            } catch (error) {
                throw new Error(`Error expanding suited range: ${error.message}`);
            }
        }

        return hands;
    }

    expandOffsuitRange(highRank, lowRank) {
        const hands = [];
        
        if (highRank === lowRank) {
            throw new Error('Pocket pairs cannot be offsuit');
        }

        // Normalize so high rank is always first
        const actualHigh = Math.max(highRank, lowRank);
        const actualLow = Math.min(highRank, lowRank);

        // For offsuit ranges like AT+, expand from the low card up to one below the high card
        // AT+ means: ATo, AJo, AQo, AKo (AT, AJ, AQ, AK as offsuit)
        // So we expand from actualLow (10, which is T) up to actualHigh-1 (13, which is K)
        const startRank = actualLow;
        const endRank = actualHigh - 1;

        for (let rank = startRank; rank <= endRank; rank++) {
            const highCard = this.cardNames[actualHigh];
            const lowCard = this.cardNames[rank];
            try {
                hands.push(new PokerHand(highCard + lowCard + 'o'));
            } catch (error) {
                throw new Error(`Error expanding offsuit range: ${error.message}`);
            }
        }

        return hands;
    }

    getHandKey(hand) {
        // Create a unique key for a hand to avoid duplicates
        if (hand.paired) {
            return `pair-${hand.highCard}`;
        } else {
            const high = hand.highCard;
            const low = hand.lowCard;
            const suit = hand.suited ? 's' : 'o';
            return `${high}-${low}-${suit}`;
        }
    }
}

// Using PokerSolver library for reliable hand evaluation

// Monte Carlo simulation for odds calculation
class OddsCalculator {
    static calculateOdds(hand1Str, hand2Str, iterations = 100000) {
        const hand1 = new PokerHand(hand1Str);
        const hand2 = new PokerHand(hand2Str);
        
        // Use Monte Carlo simulation for all calculations
        return this.calculateMonteCarloOdds(hand1, hand2, iterations);
    }
    
    static calculateMonteCarloOdds(hand1, hand2, iterations) {
        const hand1Combos = hand1.getAllPossibleCards();
        const hand2Combos = hand2.getAllPossibleCards();
        
        // Generate all valid hand combinations (no conflicts)
        const validCombinations = [];
        for (const hand1Cards of hand1Combos) {
            for (const hand2Cards of hand2Combos) {
                // Check if hands can coexist
                const hand1Set = new Set(hand1Cards.map(card => `${card.rank}-${card.suit}`));
                const hand2Set = new Set(hand2Cards.map(card => `${card.rank}-${card.suit}`));
                const hasConflict = [...hand1Set].some(card => hand2Set.has(card));
                
                if (!hasConflict) {
                    validCombinations.push({ hand1Cards, hand2Cards });
                }
            }
        }
        
        console.log(`Found ${validCombinations.length} valid combinations`);
        
        let hand1Wins = 0;
        let hand2Wins = 0;
        let ties = 0;
        
        // Sample from valid combinations
        for (let i = 0; i < iterations; i++) {
            const combo = validCombinations[Math.floor(Math.random() * validCombinations.length)];
            const result = this.simulateHandWithCards(combo.hand1Cards, combo.hand2Cards);
            
            if (result > 0) {
                hand1Wins++;
            } else if (result < 0) {
                hand2Wins++;
            } else {
                ties++;
            }
        }
        
        const total = hand1Wins + hand2Wins + ties;
        
        return {
            hand1Equity: (hand1Wins + ties / 2) / total * 100,
            hand2Equity: (hand2Wins + ties / 2) / total * 100,
            hand1Wins: hand1Wins,
            hand2Wins: hand2Wins,
            ties: ties,
            iterations: total
        };
    }
    
    static simulateHandWithCards(hand1Cards, hand2Cards) {
        // Generate remaining 5 community cards
        const usedCards = new Set();
        hand1Cards.forEach(card => usedCards.add(`${card.rank}-${card.suit}`));
        hand2Cards.forEach(card => usedCards.add(`${card.rank}-${card.suit}`));
        
        const communityCards = [];
        const suits = ['h', 'd', 'c', 's'];
        const ranks = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
        
        while (communityCards.length < 5) {
            const rank = ranks[Math.floor(Math.random() * ranks.length)];
            const suit = suits[Math.floor(Math.random() * suits.length)];
            const cardKey = `${rank}-${suit}`;
            
            if (!usedCards.has(cardKey)) {
                communityCards.push({ rank, suit });
                usedCards.add(cardKey);
            }
        }
        
        // Convert cards to pokersolver format
        const hand1Str = [...hand1Cards, ...communityCards].map(c => this.cardToString(c));
        const hand2Str = [...hand2Cards, ...communityCards].map(c => this.cardToString(c));
        
        // Evaluate hands using real pokersolver library
        const hand1Best = Hand.solve(hand1Str);
        const hand2Best = Hand.solve(hand2Str);
        
        // Compare hands (pokersolver returns winners array)
        const winners = Hand.winners([hand1Best, hand2Best]);
        
        if (winners.length === 2) {
            return 0; // Tie
        } else if (winners[0] === hand1Best) {
            return 1; // Hand 1 wins
        } else {
            return -1; // Hand 2 wins
        }
    }
    
    static cardToString(card) {
        const rankMap = {
            14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T',
            9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2'
        };
        return rankMap[card.rank] + card.suit;
    }

    static parseBoardCards(boardString) {
        if (!boardString || !boardString.trim()) {
            return [];
        }

        const cardMap = {
            'A': 14, 'K': 13, 'Q': 12, 'J': 11, 'T': 10,
            '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2
        };
        const suitMap = {
            'h': 'h', 'd': 'd', 'c': 'c', 's': 's',
            'H': 'h', 'D': 'd', 'C': 'c', 'S': 's'
        };

        // Remove spaces and parse
        const cleaned = boardString.replace(/\s+/g, '').toUpperCase();
        const cards = [];
        
        // Parse cards (format: AsKs2c or As Ks 2c)
        for (let i = 0; i < cleaned.length; i += 2) {
            if (i + 2 > cleaned.length) {
                throw new Error(`Invalid board card format: ${boardString}`);
            }
            const rankChar = cleaned[i];
            const suitChar = cleaned[i + 1];
            
            const rank = cardMap[rankChar];
            const suit = suitMap[suitChar];
            
            if (!rank || !suit) {
                throw new Error(`Invalid card in board: ${rankChar}${suitChar}`);
            }
            
            cards.push({ rank, suit });
        }

        if (cards.length > 5) {
            throw new Error(`Too many board cards: ${cards.length}. Maximum is 5.`);
        }

        return cards;
    }

    static calculateRangeEquity(range1Str, range2Str, boardCardsStr = '', iterations = 50000) {
        const parser = new RangeParser();
        
        // Parse ranges
        const range1Hands = parser.parseRange(range1Str);
        const range2Hands = parser.parseRange(range2Str);
        
        // Parse board cards
        let boardCards = [];
        if (boardCardsStr && boardCardsStr.trim()) {
            boardCards = this.parseBoardCards(boardCardsStr);
        }

        if (range1Hands.length === 0 || range2Hands.length === 0) {
            throw new Error('Both ranges must contain at least one hand');
        }

        // Calculate equity for each hand combination
        let totalEquity1 = 0;
        let totalEquity2 = 0;
        let totalCombinations = 0;
        let totalWeight = 0;

        // Determine how many hand combinations to test
        const totalHandPairs = range1Hands.length * range2Hands.length;
        const maxHandPairs = Math.min(totalHandPairs, 200); // Test up to 200 hand pairs
        const simulationsPerPair = Math.max(200, Math.floor(iterations / maxHandPairs));
        
        // Generate all hand pairs or sample if too many
        const handPairs = [];
        if (totalHandPairs <= maxHandPairs) {
            // Test all combinations
            for (const hand1 of range1Hands) {
                for (const hand2 of range2Hands) {
                    handPairs.push({ hand1, hand2 });
                }
            }
        } else {
            // Sample hand pairs
            const sampled = new Set();
            while (handPairs.length < maxHandPairs) {
                const hand1 = range1Hands[Math.floor(Math.random() * range1Hands.length)];
                const hand2 = range2Hands[Math.floor(Math.random() * range2Hands.length)];
                const pairKey = `${hand1.cards}-${hand2.cards}`;
                if (!sampled.has(pairKey)) {
                    sampled.add(pairKey);
                    handPairs.push({ hand1, hand2 });
                }
            }
        }

        // Test each hand pair with multiple card combinations
        for (const { hand1, hand2 } of handPairs) {
            const hand1Combos = hand1.getAllPossibleCards();
            const hand2Combos = hand2.getAllPossibleCards();
            
            // Test multiple card combinations for each hand pair
            const combosToTest = Math.min(10, hand1Combos.length * hand2Combos.length);
            const testedCombos = new Set();
            
            for (let comboTest = 0; comboTest < combosToTest; comboTest++) {
                // Randomly select card combinations
                const combo1 = hand1Combos[Math.floor(Math.random() * hand1Combos.length)];
                const combo2 = hand2Combos[Math.floor(Math.random() * hand2Combos.length)];
                
                const comboKey = `${combo1.map(c => `${c.rank}-${c.suit}`).join(',')}-${combo2.map(c => `${c.rank}-${c.suit}`).join(',')}`;
                if (testedCombos.has(comboKey)) {
                    continue;
                }
                testedCombos.add(comboKey);

                // Check for conflicts
                const hand1Set = new Set(combo1.map(card => `${card.rank}-${card.suit}`));
                const hand2Set = new Set(combo2.map(card => `${card.rank}-${card.suit}`));
                const boardSet = new Set(boardCards.map(card => `${card.rank}-${card.suit}`));
                
                const hasConflict = [...hand1Set].some(card => hand2Set.has(card) || boardSet.has(card)) ||
                                    [...hand2Set].some(card => boardSet.has(card));
                
                if (hasConflict) {
                    continue;
                }

                // Run simulation for this hand pair
                const result = this.simulateHandPairWithBoard(combo1, combo2, boardCards, simulationsPerPair);
                
                // Weight by number of combos (hand frequency)
                const weight = hand1Combos.length * hand2Combos.length;
                totalEquity1 += result.hand1Equity * weight;
                totalEquity2 += result.hand2Equity * weight;
                totalWeight += weight;
                totalCombinations++;
            }
        }

        if (totalCombinations === 0) {
            throw new Error('No valid hand combinations found. Check for card conflicts.');
        }

        return {
            range1Equity: totalEquity1 / totalWeight,
            range2Equity: totalEquity2 / totalWeight,
            range1HandCount: range1Hands.length,
            range2HandCount: range2Hands.length,
            combinationsTested: totalCombinations,
            handPairsTested: handPairs.length,
            iterations: totalCombinations * simulationsPerPair
        };
    }

    static simulateHandPairWithBoard(hand1Cards, hand2Cards, boardCards, iterations = 100) {
        let hand1Wins = 0;
        let hand2Wins = 0;
        let ties = 0;

        const usedCards = new Set();
        hand1Cards.forEach(card => usedCards.add(`${card.rank}-${card.suit}`));
        hand2Cards.forEach(card => usedCards.add(`${card.rank}-${card.suit}`));
        boardCards.forEach(card => usedCards.add(`${card.rank}-${card.suit}`));

        const neededCards = 5 - boardCards.length;
        const suits = ['h', 'd', 'c', 's'];
        const ranks = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];

        for (let i = 0; i < iterations; i++) {
            const communityCards = [...boardCards];
            const usedThisRound = new Set(usedCards);

            // Generate remaining community cards
            while (communityCards.length < 5) {
                const rank = ranks[Math.floor(Math.random() * ranks.length)];
                const suit = suits[Math.floor(Math.random() * suits.length)];
                const cardKey = `${rank}-${suit}`;
                
                if (!usedThisRound.has(cardKey)) {
                    communityCards.push({ rank, suit });
                    usedThisRound.add(cardKey);
                }
            }

            // Convert cards to pokersolver format
            const hand1Str = [...hand1Cards, ...communityCards].map(c => this.cardToString(c));
            const hand2Str = [...hand2Cards, ...communityCards].map(c => this.cardToString(c));
            
            // Evaluate hands
            const hand1Best = Hand.solve(hand1Str);
            const hand2Best = Hand.solve(hand2Str);
            
            // Compare hands
            const winners = Hand.winners([hand1Best, hand2Best]);
            
            if (winners.length === 2) {
                ties++;
            } else if (winners[0] === hand1Best) {
                hand1Wins++;
            } else {
                hand2Wins++;
            }
        }

        const total = hand1Wins + hand2Wins + ties;
        
        return {
            hand1Equity: (hand1Wins + ties / 2) / total * 100,
            hand2Equity: (hand2Wins + ties / 2) / total * 100,
            hand1Wins: hand1Wins,
            hand2Wins: hand2Wins,
            ties: ties
        };
    }
    
}
