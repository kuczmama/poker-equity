// Visual Range Comparison Application Logic

class VisualRangeApp {
    constructor() {
        this.range1 = new Set(); // Set of hand keys in range 1
        this.range2 = new Set(); // Set of hand keys in range 2
        this.currentTool = 'range1'; // 'range1', 'range2', or 'eraser'
        this.gridData = this.generateGridData();
        this.isPainting = false;
        this.paintedCells = new Set(); // Track cells painted in current stroke
        this.mouseDownCell = null;
        this.mouseDownTime = 0;
        this.hasMoved = false;
        this.initializeElements();
        this.bindEvents();
        this.renderGrid();
    }

    initializeElements() {
        this.gridContainer = document.getElementById('range-grid');
        this.toolRange1Btn = document.getElementById('tool-range1');
        this.toolRange2Btn = document.getElementById('tool-range2');
        this.toolEraserBtn = document.getElementById('tool-eraser');
        this.clearAllBtn = document.getElementById('clear-all');
        this.clearRange1Btn = document.getElementById('clear-range1');
        this.clearRange2Btn = document.getElementById('clear-range2');
        this.calculateBtn = document.getElementById('calculate-btn');
        this.results = document.getElementById('results');
        this.range1Count = document.getElementById('range1-count');
        this.range2Count = document.getElementById('range2-count');
        this.range1Info = document.getElementById('range1-info');
        this.range2Info = document.getElementById('range2-info');
        this.range1Equity = document.getElementById('range1-equity');
        this.range2Equity = document.getElementById('range2-equity');
        this.range1Progress = document.getElementById('range1-progress');
        this.simulationInfo = document.getElementById('simulation-info');
        this.range1HandCount = document.getElementById('range1-hand-count');
        this.range2HandCount = document.getElementById('range2-hand-count');
        
        this.parser = new RangeParser();
    }

    bindEvents() {
        // Tool selection buttons
        if (this.toolRange1Btn) {
            this.toolRange1Btn.addEventListener('click', () => {
                this.setTool('range1');
            });
        }
        
        if (this.toolRange2Btn) {
            this.toolRange2Btn.addEventListener('click', () => {
                this.setTool('range2');
            });
        }
        
        if (this.toolEraserBtn) {
            this.toolEraserBtn.addEventListener('click', () => {
                this.setTool('eraser');
            });
        }

        // Clear buttons
        if (this.clearAllBtn) {
            this.clearAllBtn.addEventListener('click', () => {
                this.range1.clear();
                this.range2.clear();
                this.updateCounts();
                this.renderGrid();
            });
        }

        if (this.clearRange1Btn) {
            this.clearRange1Btn.addEventListener('click', () => {
                this.range1.clear();
                this.updateCounts();
                this.renderGrid();
            });
        }

        if (this.clearRange2Btn) {
            this.clearRange2Btn.addEventListener('click', () => {
                this.range2.clear();
                this.updateCounts();
                this.renderGrid();
            });
        }

        // Calculate button
        if (this.calculateBtn) {
            this.calculateBtn.addEventListener('click', () => this.calculateEquity());
        }

    }
    
    setTool(tool) {
        this.currentTool = tool;
        this.updateToolDisplay();
    }
    
    updateToolDisplay() {
        // Remove active class from all tools
        [this.toolRange1Btn, this.toolRange2Btn, this.toolEraserBtn].forEach(btn => {
            if (btn) {
                btn.classList.remove('active', 'range1-active', 'range2-active', 'eraser-active');
            }
        });
        
        // Add active class to current tool
        if (this.currentTool === 'range1' && this.toolRange1Btn) {
            this.toolRange1Btn.classList.add('active', 'range1-active');
        } else if (this.currentTool === 'range2' && this.toolRange2Btn) {
            this.toolRange2Btn.classList.add('active', 'range2-active');
        } else if (this.currentTool === 'eraser' && this.toolEraserBtn) {
            this.toolEraserBtn.classList.add('active', 'eraser-active');
        }
    }

    generateGridData() {
        // Generate all 169 starting hands organized in grid coordinates
        // Traditional poker range chart format:
        // - Diagonal: pairs (AA, KK, QQ, ..., 22)
        // - Above diagonal: suited hands (AKs, AQs, ..., A2s, KQs, ..., K2s, ...)
        // - Below diagonal: offsuit hands (AKo, AQo, ..., A2o, KQo, ..., K2o, ...)
        const ranks = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
        const grid = [];
        
        for (let row = 0; row < 13; row++) {
            const rowData = [];
            for (let col = 0; col < 13; col++) {
                const rowRank = ranks[row];
                const colRank = ranks[col];
                
                let hand = null;
                if (row === col) {
                    // Diagonal: pocket pairs
                    hand = rowRank + colRank;
                } else if (row < col) {
                    // Above diagonal: suited hands
                    // Row rank is higher (A=0, K=1, so row < col means higher rank)
                    hand = rowRank + colRank + 's';
                } else {
                    // Below diagonal: offsuit hands
                    // Col rank is higher, so put it first
                    hand = colRank + rowRank + 'o';
                }
                
                rowData.push({
                    hand: hand,
                    row: row,
                    col: col,
                    key: this.getHandKey(hand)
                });
            }
            grid.push(rowData);
        }
        
        return grid;
    }

    getHandKey(handStr) {
        // Create a unique key for a hand
        // Normalize to ensure consistent key format
        const hand = new PokerHand(handStr);
        if (hand.paired) {
            return `pair-${hand.highCard}`;
        } else {
            const high = hand.highCard;
            const low = hand.lowCard;
            const suit = hand.suited ? 's' : 'o';
            return `${high}-${low}-${suit}`;
        }
    }

    renderGrid() {
        if (!this.gridContainer) return;
        
        const ranks = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
        
        // Create table
        let html = '<table class="range-grid-table"><thead><tr><th></th>';
        
        // Column headers
        for (const rank of ranks) {
            html += `<th>${rank}</th>`;
        }
        html += '</tr></thead><tbody>';
        
        // Rows
        for (let row = 0; row < 13; row++) {
            html += `<tr><th>${ranks[row]}</th>`;
            
            for (let col = 0; col < 13; col++) {
                const cell = this.gridData[row][col];
                const key = cell.key;
                const inRange1 = this.range1.has(key);
                const inRange2 = this.range2.has(key);
                
                let classes = 'grid-cell';
                if (inRange1 && inRange2) {
                    classes += ' in-both';
                } else if (inRange1) {
                    classes += ' in-range1';
                } else if (inRange2) {
                    classes += ' in-range2';
                }
                
                if (row === col) {
                    classes += ' pair';
                } else if (row < col) {
                    classes += ' suited';
                } else {
                    classes += ' offsuit';
                }
                
                html += `<td class="${classes}" data-hand="${cell.hand}" data-key="${key}">${cell.hand}</td>`;
            }
            
            html += '</tr>';
        }
        
        html += '</tbody></table>';
        
        this.gridContainer.innerHTML = html;
        
        // Add event handlers to cells
        const cells = this.gridContainer.querySelectorAll('.grid-cell');
        
        cells.forEach(cell => {
            // Prevent text selection during painting
            cell.addEventListener('selectstart', (e) => {
                if (this.isPainting) {
                    e.preventDefault();
                }
            });
            
            // Prevent context menu during painting
            cell.addEventListener('contextmenu', (e) => {
                if (this.isPainting) {
                    e.preventDefault();
                }
            });
            
            // Mouse down - prepare for painting or clicking
            cell.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.mouseDownCell = cell;
                this.mouseDownTime = Date.now();
                this.hasMoved = false;
                
                // Don't start painting yet - wait to see if it's a click or drag
            });
            
            // Mouse enter - if painting, paint the cell
            cell.addEventListener('mouseenter', (e) => {
                if (this.isPainting) {
                    this.paintCell(cell);
                } else if (this.mouseDownCell && this.mouseDownCell !== cell) {
                    // Mouse moved to a different cell - start painting
                    this.hasMoved = true;
                    this.startPainting(this.mouseDownCell); // Start with the original cell
                    this.paintCell(cell); // Paint the new cell
                }
            });
        });
        
        // Global mouse move for better painting tracking
        document.addEventListener('mousemove', (e) => {
            if (this.mouseDownCell && !this.isPainting) {
                // Check if mouse has moved significantly
                this.hasMoved = true;
                this.startPainting(this.mouseDownCell);
            }
            
            if (this.isPainting) {
                // Find cell under mouse
                const element = document.elementFromPoint(e.clientX, e.clientY);
                const cell = element?.closest('.grid-cell');
                if (cell) {
                    this.paintCell(cell);
                }
            }
        });
        
        // Global mouse up - handle click or end painting
        document.addEventListener('mouseup', (e) => {
            if (this.isPainting) {
                // Was a drag/paint - stop painting
                this.stopPainting();
            } else if (this.mouseDownCell) {
                // Check if it was a click (no movement, short duration)
                const clickDuration = Date.now() - this.mouseDownTime;
                if (!this.hasMoved && clickDuration < 300) {
                    // It was a click - toggle the cell
                    const hand = this.mouseDownCell.dataset.hand;
                    const key = this.mouseDownCell.dataset.key;
                    this.toggleHand(key, hand, this.mouseDownCell);
                }
            }
            
            // Reset mouse down state
            this.mouseDownCell = null;
            this.mouseDownTime = 0;
            this.hasMoved = false;
        });
    }
    
    startPainting(cell) {
        this.isPainting = true;
        this.paintedCells.clear();
        // Paint the starting cell
        this.paintCell(cell);
    }
    
    paintCell(cell) {
        if (!this.isPainting || !cell) return;
        
        const key = cell.dataset.key;
        
        // Skip if we already painted this cell in this stroke
        if (this.paintedCells.has(key)) return;
        
        this.paintedCells.add(key);
        
        // Apply paint based on tool (don't remove from other range - allow both)
        if (this.currentTool === 'range1') {
            this.range1.add(key);
        } else if (this.currentTool === 'range2') {
            this.range2.add(key);
        } else if (this.currentTool === 'eraser') {
            this.range1.delete(key);
            this.range2.delete(key);
        }
        
        // Update cell appearance immediately for smooth painting
        this.updateCellAppearance(cell);
        this.updateCounts();
    }
    
    updateCellAppearance(cell) {
        const key = cell.dataset.key;
        const inRange1 = this.range1.has(key);
        const inRange2 = this.range2.has(key);
        
        // Remove all state classes
        cell.classList.remove('in-range1', 'in-range2', 'in-both');
        
        // Add appropriate class
        if (inRange1 && inRange2) {
            cell.classList.add('in-both');
        } else if (inRange1) {
            cell.classList.add('in-range1');
        } else if (inRange2) {
            cell.classList.add('in-range2');
        }
    }
    
    stopPainting() {
        this.isPainting = false;
        this.paintedCells.clear();
    }

    toggleHand(key, hand, cell) {
        // Toggle based on current tool (don't remove from other range - allow both)
        if (this.currentTool === 'range1') {
            if (this.range1.has(key)) {
                this.range1.delete(key);
            } else {
                this.range1.add(key);
            }
        } else if (this.currentTool === 'range2') {
            if (this.range2.has(key)) {
                this.range2.delete(key);
            } else {
                this.range2.add(key);
            }
        } else if (this.currentTool === 'eraser') {
            this.range1.delete(key);
            this.range2.delete(key);
        }
        
        // Update cell appearance
        if (cell) {
            this.updateCellAppearance(cell);
        } else {
            // If no cell provided, find it
            const cells = this.gridContainer.querySelectorAll('.grid-cell');
            cells.forEach(c => {
                if (c.dataset.key === key) {
                    this.updateCellAppearance(c);
                }
            });
        }
        
        this.updateCounts();
    }

    updateCounts() {
        if (this.range1Count) {
            this.range1Count.textContent = this.range1.size;
        }
        if (this.range2Count) {
            this.range2Count.textContent = this.range2.size;
        }
    }

    getRangeString(handKeys) {
        // Convert set of hand keys back to range string format
        const hands = [];
        for (const key of handKeys) {
            // Parse key back to hand string
            if (key.startsWith('pair-')) {
                const rank = parseInt(key.split('-')[1]);
                const cardName = this.getCardName(rank);
                hands.push(cardName + cardName);
            } else {
                const parts = key.split('-');
                const high = parseInt(parts[0]);
                const low = parseInt(parts[1]);
                const suit = parts[2];
                const highName = this.getCardName(high);
                const lowName = this.getCardName(low);
                hands.push(highName + lowName + suit);
            }
        }
        return hands.sort().join(',');
    }

    getCardName(value) {
        const cardNames = {
            14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T',
            9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2'
        };
        return cardNames[value];
    }

    async calculateEquity() {
        if (this.range1.size === 0 || this.range2.size === 0) {
            alert('Please select at least one hand in each range');
            return;
        }
        
        try {
            const range1Str = this.getRangeString(this.range1);
            const range2Str = this.getRangeString(this.range2);
            
            // Validate ranges
            const range1Hands = this.parser.parseRange(range1Str);
            const range2Hands = this.parser.parseRange(range2Str);
            
            if (range1Hands.length === 0 || range2Hands.length === 0) {
                alert('Both ranges must contain at least one hand');
                return;
            }
            
            // Show loading state
            this.calculateBtn.textContent = 'Calculating...';
            this.calculateBtn.disabled = true;
            
            // Calculate equity
            const results = await this.runCalculation(range1Str, range2Str);
            
            this.displayResults(results);
            
        } catch (error) {
            alert(`Error: ${error.message}`);
        } finally {
            this.calculateBtn.textContent = 'Calculate Equity';
            this.calculateBtn.disabled = false;
        }
    }

    runCalculation(range1Str, range2Str) {
        return new Promise((resolve) => {
            setTimeout(() => {
                const results = OddsCalculator.calculateRangeEquity(range1Str, range2Str, '', 50000);
                resolve(results);
            }, 10);
        });
    }

    displayResults(results) {
        // Update range information
        if (this.range1Info) {
            this.range1Info.textContent = `Range 1 (${this.range1.size} hands)`;
        }
        if (this.range2Info) {
            this.range2Info.textContent = `Range 2 (${this.range2.size} hands)`;
        }
        
        // Update hand counts
        if (this.range1HandCount) {
            this.range1HandCount.textContent = `${results.range1HandCount} hands`;
        }
        if (this.range2HandCount) {
            this.range2HandCount.textContent = `${results.range2HandCount} hands`;
        }
        
        // Update equity percentages
        if (this.range1Equity) {
            this.range1Equity.textContent = `${results.range1Equity.toFixed(1)}%`;
        }
        if (this.range2Equity) {
            this.range2Equity.textContent = `${results.range2Equity.toFixed(1)}%`;
        }
        
        // Update progress bar
        if (this.range1Progress) {
            this.range1Progress.style.width = `${results.range1Equity}%`;
        }
        
        // Update simulation info
        if (this.simulationInfo) {
            this.simulationInfo.textContent = `${results.iterations.toLocaleString()} simulations (${results.handPairsTested} hand pairs, ${results.combinationsTested} combos)`;
        }
        
        // Show results
        if (this.results) {
            this.results.style.display = 'block';
            this.results.scrollIntoView({ behavior: 'smooth' });
        }
    }
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    const app = new VisualRangeApp();
    app.updateToolDisplay();
    app.updateCounts();
});

