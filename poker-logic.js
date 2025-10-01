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
        const input = this.cards.trim().toUpperCase();
        
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
            throw new Error(`Invalid hand format: ${input}. Use format like: 22, AKo, AKs, AQs`);
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
    
}
