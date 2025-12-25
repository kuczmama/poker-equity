class BetSizingApp {
    constructor() {
        this.initializeElements();
        this.attachEventListeners();
        this.selectedCards = new Set();
        this.parser = new RangeParser();
    }

    initializeElements() {
        // Inputs
        this.potSizeInput = document.getElementById('potSize');
        this.boardInput = document.getElementById('boardInput');
        this.heroHandInput = document.getElementById('heroHand');
        this.villainRangeInput = document.getElementById('villainRange');
        this.villainTypeSelect = document.getElementById('villainType');
        
        // Buttons
        this.calculateBtn = document.getElementById('calculateBtn');
        this.selectBoardBtn = document.getElementById('selectBoardBtn');
        
        // Modal
        this.modal = document.getElementById('cardSelectorModal');
        this.cardGridContainer = document.getElementById('cardGridContainer');
        this.closeModalBtn = document.getElementById('closeModalBtn');
        this.clearCardsBtn = document.getElementById('clearCardsBtn');
        
        // Results
        this.resultsPanel = document.getElementById('resultsPanel');
        this.resultsContainer = document.getElementById('resultsContainer');
    }

    attachEventListeners() {
        this.calculateBtn.addEventListener('click', () => this.calculateEV());
        this.selectBoardBtn.addEventListener('click', () => this.openCardSelector());
        this.closeModalBtn.addEventListener('click', () => this.closeCardSelector());
        this.clearCardsBtn.addEventListener('click', () => {
            this.selectedCards.clear();
            this.renderCardGrid();
            this.updateBoardInput();
        });
        
        // Close modal on outside click (if clicking the backdrop)
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.closeCardSelector();
        });
    }

    openCardSelector() {
        this.renderCardGrid();
        this.modal.classList.remove('hidden');
        this.modal.classList.add('flex');
        
        // Parse current input
        const currentText = this.boardInput.value.trim();
        if (currentText) {
            this.selectedCards.clear();
            // Basic regex to find card tokens like "As", "Kh", "2c"
            const cards = currentText.match(/[AKQJT98765432][shdc]/g);
            if (cards) {
                cards.forEach(c => {
                    this.selectedCards.add(c); 
                });
            }
            this.renderCardGrid();
        }
    }

    closeCardSelector() {
        this.modal.classList.add('hidden');
        this.modal.classList.remove('flex');
        this.updateBoardInput();
    }

    renderCardGrid() {
        this.cardGridContainer.innerHTML = '';
        
        // Create main container
        const grid = document.createElement('div');
        // Use inline style for grid-template-columns to ensure it works regardless of Tailwind config
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'auto repeat(13, 1fr)';
        grid.style.gap = '0.5rem';
        grid.className = 'min-w-[600px] bg-gray-50 dark:bg-gray-800 p-4 rounded-lg';
        
        const suits = [
            { id: 'h', label: '♥', name: 'hearts' },
            { id: 'c', label: '♣', name: 'clubs' },
            { id: 'd', label: '♦', name: 'diamonds' },
            { id: 's', label: '♠', name: 'spades' }
        ];
        
        const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

        // Header Row (Ranks)
        // Empty cell for suit column
        grid.appendChild(document.createElement('div')); 
        
        ranks.forEach(rank => {
            const header = document.createElement('div');
            header.className = 'text-center font-bold text-gray-500 dark:text-gray-400 text-sm mb-2';
            header.textContent = rank;
            grid.appendChild(header);
        });

        // Suit Rows
        suits.forEach(suit => {
            // Suit Label (First Column)
            const label = document.createElement('div');
            label.className = `suit-${suit.id} font-bold text-xl flex items-center justify-center h-10`;
            label.textContent = suit.label;
            grid.appendChild(label);

            // Card Buttons (Columns 2-14)
            ranks.forEach(rank => {
                const cardId = `${rank}${suit.id}`;
                const btn = document.createElement('div');
                
                btn.className = `
                    card-btn text-center h-10 flex items-center justify-center border rounded text-sm font-medium cursor-pointer select-none
                    transition-all duration-100 ease-in-out
                    ${this.selectedCards.has(cardId) 
                        ? 'bg-primary text-background-dark border-primary scale-105 shadow-md font-bold' 
                        : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 hover:border-gray-300 dark:hover:border-gray-500'}
                    suit-${suit.id}
                `;
                btn.textContent = rank;
                
                btn.addEventListener('click', () => this.toggleCard(cardId));
                grid.appendChild(btn);
            });
        });
        
        this.cardGridContainer.appendChild(grid);
    }

    toggleCard(cardId) {
        if (this.selectedCards.has(cardId)) {
            this.selectedCards.delete(cardId);
        } else {
            if (this.selectedCards.size >= 5) {
                alert('Maximum 5 board cards allowed');
                return;
            }
            this.selectedCards.add(cardId);
        }
        this.renderCardGrid();
    }

    updateBoardInput() {
        this.boardInput.value = Array.from(this.selectedCards).join(' ');
    }

    async calculateEV() {
        const potSize = parseFloat(this.potSizeInput.value);
        let boardInputVal = this.boardInput.value.trim();
        const heroHandInputVal = this.heroHandInput.value.trim();
        const villainRangeStr = this.villainRangeInput.value.trim();
        const villainType = this.villainTypeSelect.value;

        if (!heroHandInputVal || !villainRangeStr) {
            alert('Please fill in Hand and Opponent Range');
            return;
        }

        const originalText = this.calculateBtn.textContent;
        this.calculateBtn.textContent = 'Calculating...';
        this.calculateBtn.disabled = true;
        this.calculateBtn.classList.add('opacity-75', 'cursor-not-allowed');

        try {
            // Handle generic board notation (e.g. "A-K-J") by converting to rainbow
            const board = this.parseBoardInput(boardInputVal);
            
            // Handle generic hand notation (e.g. "AQo") by converting to specific hand for sim
            // If it's already specific (AsQc), use it. If generic, pick a representative.
            const heroHand = this.parseHeroHand(heroHandInputVal, board);

            const sizes = [0, 0.33, 0.50, 0.75, 1.0, 1.5]; // 0 is Check
            const results = [];

            // We need to parse range first to get total combo count for accurate fold %
            const fullRange = this.parser.parseRange(villainRangeStr);

            for (const sizePct of sizes) {
                const betAmount = potSize * sizePct;
                
                // 1. Calculate Fold Percentage based on Villain Type & Size
                const foldStats = this.calculateFoldStats(sizePct, villainType);
                const foldPct = foldStats.foldPct;
                const defenseFreq = 1 - foldPct;

                // 2. Adjust Range (Conceptually)
                // Get Base Equity (Check / 0% bet)
                // Note: We use the board string for the calculator
                const baseEquityResult = await this.runEquitySim(heroHand, villainRangeStr, board);
                let heroEquity = baseEquityResult.range1Equity / 100;

                // Adjust equity for bet size
                if (sizePct > 0) {
                    const equityDecay = foldPct * 0.4; // Heuristic
                    heroEquity = Math.max(0, heroEquity - equityDecay);
                }

                // 3. Calculate EV
                let ev;
                if (sizePct === 0) {
                    ev = potSize * heroEquity; 
                } else {
                    const potEquity = heroEquity * (potSize + (betAmount * 2)); 
                    const whenCalledEV = potEquity - betAmount;
                    
                    ev = (foldPct * potSize) + (defenseFreq * whenCalledEV);
                }

                results.push({
                    sizePct,
                    betAmount,
                    foldPct: foldPct * 100,
                    heroEquity: heroEquity * 100,
                    ev
                });
            }

            this.displayResults(results, potSize);

        } catch (error) {
            console.error(error);
            alert('Error calculating: ' + error.message);
        } finally {
            this.calculateBtn.textContent = originalText;
            this.calculateBtn.disabled = false;
            this.calculateBtn.classList.remove('opacity-75', 'cursor-not-allowed');
        }
    }

    // Helper to handle generic inputs like "A-K-J" -> "Ah Ks Jd"
    parseBoardInput(input) {
        if (!input) return "";
        
        // If it already looks like "Ah Ks Jd", return as is
        if (input.match(/[AKQJT98765432][shdc]/)) {
            return input;
        }

        // Handle "A-K-J" or "AKJ"
        const cleaned = input.replace(/[^AKQJT98765432]/g, '');
        const ranks = cleaned.split('');
        const suits = ['h', 's', 'd', 'c']; // Rainbow suits
        
        return ranks.map((r, i) => `${r}${suits[i % 4]}`).join(' ');
    }

    // Helper to handle generic hand inputs like "AQo" -> "As Qc"
    parseHeroHand(input, boardStr) {
        // If it looks like specific cards "AsQc", return normalized
        if (input.match(/[AKQJT98765432][shdc].*[AKQJT98765432][shdc]/)) {
            return input;
        }

        // Handle generic ranges: AQo, AQs, AA, TT
        // We need to pick a valid specific hand that doesn't conflict with board
        const parser = new RangeParser();
        try {
            // Expand the generic hand into all possible specific combos
            const hands = parser.parseRange(input);
            if (hands.length === 0) throw new Error("Invalid hand");

            // Filter out hands that conflict with the board
            const boardCards = this.getCardsFromStr(boardStr);
            const validHand = hands.find(hand => {
                const handCards = this.getCardsFromStr(hand.cards); // e.g. "AsKh" -> ["As", "Kh"]
                // Check if any card in hand is in board
                return !handCards.some(hc => boardCards.includes(hc));
            });

            if (!validHand) {
                throw new Error("All combos of this hand conflict with board");
            }
            return validHand.cards; // Returns e.g. "AsKh"

        } catch (e) {
            console.error("Hand parsing error", e);
            // Fallback: just return input and let main calculator error if bad
            return input; 
        }
    }

    getCardsFromStr(str) {
         return str.match(/[AKQJT98765432][shdc]/g) || [];
    }

    calculateFoldStats(sizePct, type) {
        if (sizePct === 0) return { foldPct: 0 };

        let defenseFreq;
        
        switch (type) {
            case 'inelastic':
                defenseFreq = 0.7; 
                break;
            case 'fit-or-fold':
                defenseFreq = 0.4; 
                break;
            case 'elastic':
            default:
                const mdf = 1 / (1 + sizePct);
                defenseFreq = mdf * 0.9; 
        }

        return { foldPct: 1 - defenseFreq };
    }

    async runEquitySim(hand, range, board) {
        await new Promise(r => setTimeout(r, 0));
        return OddsCalculator.calculateRangeEquity(hand, range, board, 2000); 
    }

    displayResults(results, potSize) {
        this.resultsPanel.style.display = 'block';
        this.resultsContainer.innerHTML = '';

        // Find best EV
        const bestEV = Math.max(...results.map(r => r.ev));

        results.forEach(res => {
            const isBest = res.ev === bestEV;
            const sizeLabel = res.sizePct === 0 ? 'Check' : `${res.sizePct * 100}% ($${res.betAmount})`;
            
            const row = document.createElement('div');
            // Tailwind classes for the result row
            row.className = `
                bet-row p-4 rounded-lg border transition-colors
                ${isBest 
                    ? 'bg-primary/10 border-primary dark:bg-primary/20 dark:border-primary' 
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-primary/50'}
            `;
            
            row.innerHTML = `
                <div class="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div class="w-24 font-bold text-gray-900 dark:text-white shrink-0">${sizeLabel}</div>
                    
                    <div class="flex-grow space-y-3 w-full">
                        <div class="grid grid-cols-3 gap-2 text-sm">
                            <div class="text-center p-2 rounded bg-gray-50 dark:bg-gray-900/50">
                                <span class="block text-gray-500 dark:text-gray-400 text-xs">EV</span>
                                <strong class="${res.ev >= 0 ? 'text-primary' : 'text-red-500'}">$${res.ev.toFixed(2)}</strong>
                            </div>
                            <div class="text-center p-2 rounded bg-gray-50 dark:bg-gray-900/50">
                                <span class="block text-gray-500 dark:text-gray-400 text-xs">Fold %</span>
                                <span class="text-gray-900 dark:text-white">${res.foldPct.toFixed(0)}%</span>
                            </div>
                            <div class="text-center p-2 rounded bg-gray-50 dark:bg-gray-900/50">
                                <span class="block text-gray-500 dark:text-gray-400 text-xs">Equity</span>
                                <span class="text-gray-900 dark:text-white">${res.heroEquity.toFixed(1)}%</span>
                            </div>
                        </div>
                        
                        <div class="h-6 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden relative">
                            <!-- Zero line indicator -->
                            <div class="absolute left-0 top-0 bottom-0 w-px bg-gray-400 z-10" style="left: ${res.ev < 0 ? '50%' : '0'}"></div>
                            
                            <div class="h-full rounded-full transition-all duration-500 ${res.ev < 0 ? 'bg-red-500' : 'bg-primary'}" 
                                 style="width: ${Math.min(100, Math.abs(res.ev / potSize) * 100)}%"></div>
                        </div>
                    </div>
                </div>
            `;
            
            this.resultsContainer.appendChild(row);
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new BetSizingApp();
});
