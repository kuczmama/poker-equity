// Range Equity Calculator Application Logic

// Predefined position ranges
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

class RangeEquityApp {
    constructor() {
        this.initializeElements();
        this.bindEvents();
        this.loadFromURL();
        this.updateRangePreviews();
    }

    initializeElements() {
        this.range1Input = document.getElementById('range1');
        this.range2Input = document.getElementById('range2');
        this.position1Select = document.getElementById('position1');
        this.position2Select = document.getElementById('position2');
        this.boardInput = document.getElementById('board');
        this.calculateBtn = document.getElementById('calculate-btn');
        this.results = document.getElementById('results');
        this.range1Preview = document.getElementById('range1-preview');
        this.range2Preview = document.getElementById('range2-preview');
        
        // Result elements
        this.range1Info = document.getElementById('range1-info');
        this.range2Info = document.getElementById('range2-info');
        this.range1Equity = document.getElementById('range1-equity');
        this.range2Equity = document.getElementById('range2-equity');
        this.range1Progress = document.getElementById('range1-progress');
        this.range1HandCount = document.getElementById('range1-hand-count');
        this.range2HandCount = document.getElementById('range2-hand-count');
        this.simulationInfo = document.getElementById('simulation-info');
        
        this.exampleBtns = document.querySelectorAll('.example-btn');
        this.parser = new RangeParser();
    }

    bindEvents() {
        this.calculateBtn.addEventListener('click', () => this.calculateEquity());
        
        this.range1Input.addEventListener('input', () => {
            this.updateRangePreview(this.range1Input.value, this.range1Preview);
            this.updateURL();
        });
        
        this.range2Input.addEventListener('input', () => {
            this.updateRangePreview(this.range2Input.value, this.range2Preview);
            this.updateURL();
        });
        
        this.position1Select.addEventListener('change', () => {
            this.applyPositionRange(1);
            this.updateURL();
        });
        this.position2Select.addEventListener('change', () => {
            this.applyPositionRange(2);
            this.updateURL();
        });
        this.boardInput.addEventListener('input', () => this.updateURL());
        
        // Enter key support
        this.range1Input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.calculateEquity();
        });
        
        this.range2Input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.calculateEquity();
        });
        
        this.boardInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.calculateEquity();
        });
        
        // Example buttons
        this.exampleBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const range1 = btn.dataset.range1;
                const range2 = btn.dataset.range2;
                const pos1 = btn.dataset.pos1;
                const pos2 = btn.dataset.pos2;
                
                if (range1) this.range1Input.value = range1;
                if (range2) this.range2Input.value = range2;
                if (pos1) {
                    this.position1Select.value = pos1;
                    // Apply position range if not explicitly set
                    if (!range1) {
                        this.applyPositionRange(1);
                    }
                }
                if (pos2) {
                    this.position2Select.value = pos2;
                    // Apply position range if not explicitly set
                    if (!range2) {
                        this.applyPositionRange(2);
                    }
                }
                
                this.updateRangePreviews();
                this.updateURL();
                this.calculateEquity();
            });
        });
    }

    loadFromURL() {
        const params = new URLSearchParams(window.location.search);
        const range1 = params.get('range1');
        const range2 = params.get('range2');
        const pos1 = params.get('pos1');
        const pos2 = params.get('pos2');
        const board = params.get('board');
        
        if (pos1) {
            this.position1Select.value = pos1;
        }
        
        if (pos2) {
            this.position2Select.value = pos2;
        }
        
        if (range1) {
            this.range1Input.value = range1;
        } else if (pos1) {
            // Apply position range if position is set but range is not
            this.applyPositionRange(1);
        } else {
            // Apply default position range for position1
            this.applyPositionRange(1);
        }
        
        if (range2) {
            this.range2Input.value = range2;
        } else if (pos2) {
            // Apply position range if position is set but range is not
            this.applyPositionRange(2);
        } else {
            // Apply default position range for position2
            this.applyPositionRange(2);
        }
        
        if (board) {
            this.boardInput.value = board;
        }
        
        // If both ranges are provided in URL, auto-calculate
        if (range1 && range2) {
            setTimeout(() => {
                this.calculateEquity();
            }, 100);
        }
    }

    updateURL() {
        const range1 = this.range1Input.value.trim();
        const range2 = this.range2Input.value.trim();
        const pos1 = this.position1Select.value;
        const pos2 = this.position2Select.value;
        const board = this.boardInput.value.trim();
        
        const params = new URLSearchParams();
        if (range1) {
            params.set('range1', range1);
        }
        if (range2) {
            params.set('range2', range2);
        }
        if (pos1) {
            params.set('pos1', pos1);
        }
        if (pos2) {
            params.set('pos2', pos2);
        }
        if (board) {
            params.set('board', board);
        }
        
        const newURL = params.toString() 
            ? `${window.location.pathname}?${params.toString()}`
            : window.location.pathname;
        
        window.history.replaceState({}, '', newURL);
    }

    applyPositionRange(rangeNumber) {
        const positionSelect = rangeNumber === 1 ? this.position1Select : this.position2Select;
        const rangeInput = rangeNumber === 1 ? this.range1Input : this.range2Input;
        const preview = rangeNumber === 1 ? this.range1Preview : this.range2Preview;
        
        const position = positionSelect.value;
        const defaultRange = POSITION_RANGES[position];
        
        if (defaultRange) {
            rangeInput.value = defaultRange;
            this.updateRangePreview(defaultRange, preview);
        }
    }

    updateRangePreviews() {
        this.updateRangePreview(this.range1Input.value, this.range1Preview);
        this.updateRangePreview(this.range2Input.value, this.range2Preview);
    }

    updateRangePreview(rangeValue, previewElement) {
        try {
            if (rangeValue.trim() === '') {
                previewElement.textContent = '';
                previewElement.className = 'range-preview';
                return;
            }
            
            const hands = this.parser.parseRange(rangeValue);
            previewElement.textContent = `${hands.length} hands`;
            previewElement.className = 'range-preview valid';
        } catch (error) {
            previewElement.textContent = `Invalid: ${error.message}`;
            previewElement.className = 'range-preview invalid';
        }
    }

    async calculateEquity() {
        const range1Value = this.range1Input.value.trim();
        const range2Value = this.range2Input.value.trim();
        const boardValue = this.boardInput.value.trim();
        
        if (!range1Value || !range2Value) {
            alert('Please enter both ranges');
            return;
        }
        
        try {
            // Validate ranges
            const range1Hands = this.parser.parseRange(range1Value);
            const range2Hands = this.parser.parseRange(range2Value);
            
            if (range1Hands.length === 0 || range2Hands.length === 0) {
                alert('Both ranges must contain at least one hand');
                return;
            }
            
            // Validate board cards if provided
            if (boardValue) {
                try {
                    OddsCalculator.parseBoardCards(boardValue);
                } catch (error) {
                    alert(`Invalid board cards: ${error.message}`);
                    return;
                }
            }
            
            // Show loading state
            this.calculateBtn.textContent = 'Calculating...';
            this.calculateBtn.disabled = true;
            
            // Calculate equity (using async to prevent UI blocking)
            const results = await this.runCalculation(range1Value, range2Value, boardValue);
            
            this.displayResults(results);
            this.updateURL();
            
        } catch (error) {
            alert(`Error: ${error.message}`);
        } finally {
            this.calculateBtn.textContent = 'Calculate Range Equity';
            this.calculateBtn.disabled = false;
        }
    }

    runCalculation(range1Str, range2Str, boardStr) {
        return new Promise((resolve) => {
            // Use setTimeout to allow UI updates
            setTimeout(() => {
                // Use more iterations for better accuracy
                const results = OddsCalculator.calculateRangeEquity(range1Str, range2Str, boardStr, 50000);
                resolve(results);
            }, 10);
        });
    }

    displayResults(results) {
        const pos1 = this.position1Select.value;
        const pos2 = this.position2Select.value;
        
        // Update range information
        this.range1Info.textContent = `Range 1 (${pos1})`;
        this.range2Info.textContent = `Range 2 (${pos2})`;
        
        // Update equity percentages
        this.range1Equity.textContent = `${results.range1Equity.toFixed(1)}%`;
        this.range2Equity.textContent = `${results.range2Equity.toFixed(1)}%`;
        
        // Update progress bar
        this.range1Progress.style.width = `${results.range1Equity}%`;
        
        // Update hand counts
        this.range1HandCount.textContent = `${results.range1HandCount} hands`;
        this.range2HandCount.textContent = `${results.range2HandCount} hands`;
        
        // Update simulation info
        this.simulationInfo.textContent = `${results.iterations.toLocaleString()} simulations (${results.handPairsTested} hand pairs, ${results.combinationsTested} combos)`;
        
        // Show results
        this.results.style.display = 'block';
        
        // Scroll to results
        this.results.scrollIntoView({ behavior: 'smooth' });
    }
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new RangeEquityApp();
});

