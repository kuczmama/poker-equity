// Pokersolver library - simplified version for our use case
// Based on: https://github.com/goldfire/pokersolver

(function() {
  'use strict';

  // Card rank mapping
  const RANKS = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
  };

  const RANK_NAMES = {
    2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
    10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A'
  };

  const SUITS = {
    'h': 'hearts', 'd': 'diamonds', 'c': 'clubs', 's': 'spades'
  };

  // Hand rankings
  const HAND_RANKINGS = {
    'straightflush': 8,
    'quads': 7,
    'fullhouse': 6,
    'flush': 5,
    'straight': 4,
    'trips': 3,
    'twopair': 2,
    'pair': 1,
    'highcard': 0
  };

  // Convert our card format to pokersolver format
  function convertCard(card) {
    const rank = RANK_NAMES[card.rank];
    const suit = Object.keys(SUITS).find(s => SUITS[s] === Object.keys(SUITS)[Object.values(SUITS).indexOf('hearts')]);
    
    // Map our suit format to pokersolver format
    let suitChar;
    switch(card.suit) {
      case 'h': suitChar = 'h'; break;
      case 'd': suitChar = 'd'; break;
      case 'c': suitChar = 'c'; break;
      case 's': suitChar = 's'; break;
      default: suitChar = 'h';
    }
    
    return rank + suitChar;
  }

  // Evaluate a hand
  function evaluateHand(cards) {
    if (cards.length < 5) {
      throw new Error('Need at least 5 cards');
    }

    // Convert cards to pokersolver format
    const solverCards = cards.map(convertCard);
    
    // Find best 5-card hand
    let bestHand = null;
    
    // Generate all 5-card combinations
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        for (let k = j + 1; k < cards.length; k++) {
          for (let l = k + 1; l < cards.length; l++) {
            for (let m = l + 1; m < cards.length; m++) {
              const fiveCards = [solverCards[i], solverCards[j], solverCards[k], solverCards[l], solverCards[m]];
              const hand = Hand.solve(fiveCards);
              
              if (!bestHand || hand.rank > bestHand.rank) {
                bestHand = hand;
              }
            }
          }
        }
      }
    }
    
    return bestHand;
  }

  // Compare two hands
  function compareHands(hand1, hand2) {
    if (hand1.rank !== hand2.rank) {
      return hand1.rank - hand2.rank; // Higher rank is better
    }
    
    // Compare values for hands of same rank
    for (let i = 0; i < Math.min(hand1.values.length, hand2.values.length); i++) {
      if (hand1.values[i] !== hand2.values[i]) {
        return hand1.values[i] - hand2.values[i]; // Higher value is better
      }
    }
    
    return 0; // Tie
  }

  // Main Hand class (simplified)
  function Hand(cards, name, rank, values) {
    this.cards = cards;
    this.name = name;
    this.rank = rank;
    this.values = values;
  }

  Hand.solve = function(cards) {
    if (cards.length !== 5) {
      throw new Error('Must have exactly 5 cards');
    }

    const ranks = cards.map(card => RANKS[card[0]]).sort((a, b) => b - a);
    const suits = cards.map(card => card[1]);
    
    const rankCounts = {};
    ranks.forEach(rank => {
      rankCounts[rank] = (rankCounts[rank] || 0) + 1;
    });
    
    const counts = Object.values(rankCounts).sort((a, b) => b - a);
    const isFlush = suits.every(suit => suit === suits[0]);
    const isStraight = isStraightCheck(ranks);
    
    // Check for straight flush
    if (isFlush && isStraight) {
      return new Hand(cards, 'Straight Flush', 8, [ranks[0]]);
    }
    
    // Check for four of a kind
    if (counts[0] === 4) {
      const fourKind = Object.keys(rankCounts).find(rank => rankCounts[rank] === 4);
      const kicker = Object.keys(rankCounts).find(rank => rankCounts[rank] === 1);
      return new Hand(cards, 'Four of a Kind', 7, [parseInt(fourKind), parseInt(kicker)]);
    }
    
    // Check for full house
    if (counts[0] === 3 && counts[1] === 2) {
      const threeKind = Object.keys(rankCounts).find(rank => rankCounts[rank] === 3);
      const pair = Object.keys(rankCounts).find(rank => rankCounts[rank] === 2);
      return new Hand(cards, 'Full House', 6, [parseInt(threeKind), parseInt(pair)]);
    }
    
    // Check for flush
    if (isFlush) {
      return new Hand(cards, 'Flush', 5, ranks);
    }
    
    // Check for straight
    if (isStraight) {
      return new Hand(cards, 'Straight', 4, [ranks[0]]);
    }
    
    // Check for three of a kind
    if (counts[0] === 3) {
      const threeKind = Object.keys(rankCounts).find(rank => rankCounts[rank] === 3);
      const kickers = Object.keys(rankCounts)
        .filter(rank => rankCounts[rank] === 1)
        .map(rank => parseInt(rank))
        .sort((a, b) => b - a);
      return new Hand(cards, 'Three of a Kind', 3, [parseInt(threeKind), ...kickers]);
    }
    
    // Check for two pair
    if (counts[0] === 2 && counts[1] === 2) {
      const pairs = Object.keys(rankCounts)
        .filter(rank => rankCounts[rank] === 2)
        .map(rank => parseInt(rank))
        .sort((a, b) => b - a);
      const kicker = Object.keys(rankCounts).find(rank => rankCounts[rank] === 1);
      return new Hand(cards, 'Two Pair', 2, [...pairs, parseInt(kicker)]);
    }
    
    // Check for pair
    if (counts[0] === 2) {
      const pair = Object.keys(rankCounts).find(rank => rankCounts[rank] === 2);
      const kickers = Object.keys(rankCounts)
        .filter(rank => rankCounts[rank] === 1)
        .map(rank => parseInt(rank))
        .sort((a, b) => b - a);
      return new Hand(cards, 'Pair', 1, [parseInt(pair), ...kickers]);
    }
    
    // High card
    return new Hand(cards, 'High Card', 0, ranks);
  };

  function isStraightCheck(ranks) {
    // Check for regular straight
    for (let i = 0; i < ranks.length - 4; i++) {
      if (ranks[i] - ranks[i + 4] === 4) {
        return true;
      }
    }
    
    // Check for A-2-3-4-5 straight
    if (ranks[0] === 14 && ranks[1] === 5 && ranks[2] === 4 && ranks[3] === 3 && ranks[4] === 2) {
      return true;
    }
    
    return false;
  }

  // Export for global use
  window.PokerSolver = {
    Hand: Hand,
    evaluateHand: evaluateHand,
    compareHands: compareHands
  };

})();
