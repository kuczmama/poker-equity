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
                const match = line.match(/\[(.*?)\]/);
                if (match) data.board = match[1].split(' ').map(c => c.replace('10', 'T'));
            }

            // Actions (Preflop focus for now)
            if (line.startsWith('*** HOLE CARDS ***')) section = 'preflop';
            if (line.startsWith('*** FLOP ***')) section = 'flop';
            if (line.startsWith('*** TURN ***')) section = 'turn';
            if (line.startsWith('*** RIVER ***')) section = 'river';

            if (section === 'preflop' && !line.startsWith('***')) {
                // Parse "Player: action amount"
                if (line.includes('folds')) this.recordAction(data, line, 'fold');
                else if (line.includes('calls')) this.recordAction(data, line, 'call');
                else if (line.includes('raises')) this.recordAction(data, line, 'raise');
                else if (line.includes('checks')) this.recordAction(data, line, 'check');
                else if (line.includes('posts')) this.recordAction(data, line, 'post');
            }
        }

        this.calculatePositions(data);
        return data;
    }

    recordAction(data, line, type) {
        // Simple extraction: "Name: type amount"
        const parts = line.split(':');
        const name = parts[0];
        
        // Extract amount if any
        let amount = 0;
        const numbers = line.match(/([\d\.]+)/g);
        if (numbers) {
            // "raises 0.10 to 0.15" -> take last number as the wager
            // "calls 0.15" -> take last number
            amount = parseFloat(numbers[numbers.length - 1]);
        }

        data.preflopActions.push({
            player: name,
            type: type,
            amount: amount,
            raw: line
        });
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
                // Depending on table size, map UTG, MP, etc.
                // Assuming 6-max or 7-max common on CoinPoker
                if (n === 6) {
                    if (dist === 3) pos = 'UTG';
                    if (dist === 4) pos = 'HJ';
                    if (dist === 5) pos = 'CO';
                } else if (n === 7) {
                    if (dist === 3) pos = 'UTG';
                    if (dist === 4) pos = 'UTG+1';
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
                    // Fallback
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
}

