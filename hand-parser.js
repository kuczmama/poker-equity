class CoinPokerParser {
    constructor() {
        // Standard 7-max order from logic relative to BTN
        // BTN=0, SB=1, BB=2...
    }

    parse(text) {
        if (!text) throw new Error("No hand history text provided");

        const lines = text.split('\n').map(l => l.trim()).filter(l => l);
        const data = {
            handId: null,
            tableSize: 7, // Default to 7-max
            buttonSeat: 0,
            players: [],
            hero: null, // { name, seat, hand: [], pos: '' }
            actions: [],
            board: [],
            potSize: 0,
            preflopActions: [],
            streets: {
                preflop: { actions: [], potStart: 0, potEnd: 0 },
                flop: { actions: [], card: [], potStart: 0, potEnd: 0 },
                turn: { actions: [], card: [], potStart: 0, potEnd: 0 },
                river: { actions: [], card: [], potStart: 0, potEnd: 0 }
            },
            variant: 'NLHE'
        };

        let section = 'header';
        
        for (let line of lines) {
            // Header & Metadata
            if (line.startsWith('CoinPoker Hand #')) {
                const match = line.match(/Hand #(\d+)/);
                if (match) data.handId = match[1];
                if (line.includes('Hold\'em')) data.variant = 'NLHE';
                if (line.includes('Omaha')) data.variant = 'PLO';
            }
            if (line.startsWith('Table')) {
                const seatMatch = line.match(/Seat #(\d+) is the button/);
                if (seatMatch) data.buttonSeat = parseInt(seatMatch[1]);
            }

            // Players
            if (line.startsWith('Seat ') && line.includes('in chips')) {
                const match = line.match(/Seat (\d+): (.+) \(([\d\.,]+) in chips\)/);
                if (match) {
                    data.players.push({
                        seat: parseInt(match[1]),
                        name: match[2],
                        stack: parseFloat(match[3].replace(',', ''))
                    });
                }
            }

            // Hero Identification
            if (line.startsWith('Dealt to ')) {
                const match = line.match(/Dealt to (.+) \[(.+)\]/);
                if (match) {
                    data.hero = { 
                        name: match[1], 
                        handStr: match[2].replace(/\s/g, '').replace(/10/g, 'T') // Normalize to "AsKh"
                    };
                }
            }

            // Board
            if (line.startsWith('*** FLOP ***')) {
                section = 'flop';
                const match = line.match(/\[(.*?)\]/);
                if (match) data.streets.flop.card = match[1].split(' ').map(c => c.replace('10', 'T'));
            }
            if (line.startsWith('*** TURN ***')) {
                section = 'turn';
                // Format: *** TURN *** [FlopCards] [TurnCard]
                const match = line.match(/\] \[(.*?)\]/);
                if (match) data.streets.turn.card = [match[1].replace('10', 'T')];
            }
            if (line.startsWith('*** RIVER ***')) {
                section = 'river';
                const match = line.match(/\] \[(.*?)\]/);
                if (match) data.streets.river.card = [match[1].replace('10', 'T')];
            }

            // Actions
            if (line.startsWith('*** HOLE CARDS ***')) section = 'preflop';
            if (line.startsWith('*** SUMMARY ***')) section = 'summary';

            if ((section === 'preflop' || section === 'flop' || section === 'turn' || section === 'river') && !line.startsWith('***')) {
                // Parse "Player: action amount"
                let type = null;
                if (line.includes('folds')) type = 'fold';
                else if (line.includes('calls')) type = 'call';
                else if (line.includes('raises')) type = 'raise';
                else if (line.includes('checks')) type = 'check';
                else if (line.includes('bets')) type = 'bet';
                else if (line.includes('posts')) type = 'post';

                if (type) {
                    this.recordAction(data, line, type, section);
                }
            }
        }

        this.calculatePositions(data);
        this.processMath(data);
        return data;
    }

    recordAction(data, line, type, section) {
        // Simple extraction: "Name: type amount"
        const parts = line.split(':');
        const name = parts[0];
        
        // Extract amount if any
        let amount = 0;
        // Check for "raises X to Y" - we want Y (total wager) for state tracking, but technically "call" is the difference.
        // For simple pot tracking, we need the *added* amount.
        
        const numbers = line.match(/([\d\.]+)/g);
        let rawAmount = 0;
        let addedAmount = 0;

        if (numbers) {
            rawAmount = parseFloat(numbers[numbers.length - 1]);
        }

        data.streets[section].actions.push({
            player: name,
            type: type,
            amount: rawAmount, // This is usually the "to" amount or the call amount
            raw: line
        });
        
        // Populate flat preflopActions for backward compatibility
        if (section === 'preflop') {
            data.preflopActions.push({
                player: name,
                type: type,
                amount: rawAmount,
                raw: line
            });
        }
    }

    calculatePositions(data) {
        if (!data.buttonSeat || data.players.length === 0) return;

        // Sort players by seat
        data.players.sort((a, b) => a.seat - b.seat);

        // Find BTN index in sorted list
        const btnIndex = data.players.findIndex(p => p.seat === data.buttonSeat);
        if (btnIndex === -1) return; 

        const n = data.players.length;
        
        // Map distance from BTN (clockwise)
        data.players.forEach((p, i) => {
            // (i - btnIndex + n) % n gives 0 for BTN, 1 for SB, etc.
            const dist = (i - btnIndex + n) % n;
            
            let pos = '';
            // Standard mapping logic
            if (dist === 0) pos = 'BTN';
            else if (dist === 1) pos = 'SB';
            else if (dist === 2) pos = 'BB';
            else {
                if (n === 6) {
                    if (dist === 3) pos = 'UTG';
                    if (dist === 4) pos = 'HJ';
                    if (dist === 5) pos = 'CO';
                } else if (n === 7) {
                    if (dist === 3) pos = 'UTG';
                    if (dist === 4) pos = 'LJ';
                    if (dist === 5) pos = 'HJ';
                    if (dist === 6) pos = 'CO';
                } else if (n === 9) {
                     if (dist === 3) pos = 'UTG';
                     if (dist === 4) pos = 'UTG+1';
                     if (dist === 5) pos = 'UTG+2';
                     if (dist === 6) pos = 'LJ';
                     if (dist === 7) pos = 'HJ';
                     if (dist === 8) pos = 'CO';
                } else {
                    pos = `Pos${dist}`;
                }
            }

            p.pos = pos;
            if (data.hero && data.hero.name === p.name) {
                data.hero.pos = pos;
                data.hero.seatObj = p;
            }
        });
    }

    processMath(data) {
        // Replay hand to calculate Pot, Pot Odds, MDF at each step
        let pot = 0;
        let streetInvested = {}; // Map player -> amount invested this street
        let currentBet = 0;
        
        ['preflop', 'flop', 'turn', 'river'].forEach(street => {
            streetInvested = {};
            currentBet = 0;
            data.streets[street].potStart = pot;
            
            data.streets[street].actions.forEach(action => {
                // Determine amount added to pot
                let added = 0;
                let playerInvested = streetInvested[action.player] || 0;

                if (action.type === 'post') {
                    added = action.amount;
                    streetInvested[action.player] = playerInvested + added;
                    if (added > currentBet) currentBet = added;
                } else if (action.type === 'call') {
                    // Call matches the current bet
                    // Sometimes "calls 0.15" means adding 0.15
                    added = action.amount;
                    streetInvested[action.player] = playerInvested + added;
                } else if (action.type === 'bet') {
                    added = action.amount;
                    streetInvested[action.player] = playerInvested + added;
                    currentBet = added;
                } else if (action.type === 'raise') {
                    // "raises to X" -> X is total for street
                    const total = action.amount;
                    added = total - playerInvested;
                    streetInvested[action.player] = total;
                    currentBet = total;
                } else if (action.type === 'check' || action.type === 'fold') {
                    added = 0;
                }

                pot += added;
                action.potAfter = pot;

                // Calculate Math for Hero
                if (data.hero && action.player === data.hero.name) {
                    // If Hero just acted, what were they facing?
                    // Pot Odds = CallAmount / (TotalPot + CallAmount)
                    // We need to look at state *before* this action
                    
                    const heroPrevInvested = (streetInvested[action.player] || 0) - added;
                    const amountToCall = currentBet - heroPrevInvested;
                    const potBeforeHero = pot - added;

                    if (amountToCall > 0 && (action.type === 'call' || action.type === 'fold' || action.type === 'raise')) {
                        // Facing a bet
                        const potOdds = amountToCall / (potBeforeHero + amountToCall);
                        const mdf = 1 - (amountToCall / (potBeforeHero + amountToCall)); // Simple MDF approximation
                        // Wait, MDF is Pot / (Pot + Bet) from defender's perspective? 
                        // MDF = Pot / (Pot + Bet) ? No. 
                        // MDF = 1 - Alpha. Alpha = Bet / (Pot + Bet).
                        // If Pot is 100, Villain bets 50. Pot becomes 150.
                        // Alpha = 50/150 = 33%. MDF = 67%.
                        // Here potBeforeHero includes the Villain's bet.
                        // So if Pot was 100, Villain bets 50 -> PotBeforeHero = 150.
                        // AmountToCall = 50.
                        // Pot Odds = 50 / (150 + 50) = 25%.
                        
                        // MDF: We use Pot Size *before* the bet for the formula?
                        // Formula: MDF = PotSize / (PotSize + BetSize)
                        // PotSize here is the pot BEFORE the villain bet.
                        // So PotBeforeHero - AmountToCall.
                        const potBase = potBeforeHero - amountToCall;
                        // But there might be other players.
                        // Simplified: MDF = (Pot including bet) / (Pot including bet + call) ? No.
                        
                        // Standard MDF = Pot / (Pot + Bet). 
                        // Where Pot is what's in the middle before the bet.
                        // Bet is the bet size.
                        // Here potBeforeHero has the bet.
                        // So MDF = (potBeforeHero - amountToCall) / potBeforeHero.
                        
                        // Let's stick to Pot Odds for Hero.
                        action.math = {
                            potOddsPct: (potOdds * 100).toFixed(1),
                            amountToCall: amountToCall.toFixed(2),
                            potSize: potBeforeHero.toFixed(2)
                        };
                    }
                }
            });
            
            data.streets[street].potEnd = pot;
        });
    }
}
