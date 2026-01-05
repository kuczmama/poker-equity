/**
 * GTO Grid Renderer
 * Responsible for generating the visual representation of poker ranges
 * including mixed strategies (gradients).
 */
class GTORenderer {
    constructor() {
        // Define colors for actions matching GTO Wizard style
        this.colors = {
            'fold': '#4772b8',      // GTO Wizard Blue-ish Fold
            'call': '#2c9f45',      // Green (Call)
            'raise': '#b93c3c',     // Red (Raise) - generic
            'raise_small': '#b93c3c', // Red (Small Raise)
            'raise_big': '#8a2323', // Darker Red (Big Raise/3bet)
            'all_in': '#6d1b1b',     // Deep Red (All-in)
            'raise_all_in': '#6d1b1b', // Ensure tree-manager key matches
            'out_of_range': '#000000' // Pure Black
        };
    }

    /**
     * Get color for any action, including granular raise sizes like 'raise_7.5'
     */
    getColorForAction(action) {
        // Direct match
        if (this.colors[action]) {
            return this.colors[action];
        }
        
        // Handle granular raise sizes (raise_2.5, raise_7.5, raise_12, etc.)
        if (action.startsWith('raise_')) {
            const sizeStr = action.replace('raise_', '');
            const size = parseFloat(sizeStr);
            
            if (!isNaN(size)) {
                // Color gradient based on raise size:
                // Small raises (2-4bb): Light red
                // 3-bets (6-16bb): Medium red  
                // 4-bets (18-30bb): Dark red
                // 5-bets+ (30+bb): Deep red
                if (size <= 4) return '#c94444';      // Light red (open raises)
                if (size <= 16) return '#b93c3c';     // Medium red (3-bets)
                if (size <= 30) return '#9a2b2b';     // Dark red (4-bets)
                return '#7a1b1b';                      // Deep red (5-bets)
            }
            
            // If we can't parse, use generic raise color
            return this.colors['raise'];
        }
        
        // Unknown action
        return '#333';
    }

    /**
     * Get sorting priority for action (lower = bottom of gradient)
     */
    getActionPriority(action) {
        // Base priorities
        const basePriority = {
            'out_of_range': 0,
            'fold': 10,
            'call': 20,
            'raise': 30,
            'raise_small': 30,
            'raise_big': 40,
            'all_in': 50,
            'raise_all_in': 50
        };
        
        if (basePriority[action] !== undefined) {
            return basePriority[action];
        }
        
        // Handle granular raises - sort by size (smaller raises lower priority)
        if (action.startsWith('raise_')) {
            const sizeStr = action.replace('raise_', '');
            const size = parseFloat(sizeStr);
            if (!isNaN(size)) {
                // Raises sorted by size: 30 (base) + size for ordering
                return 30 + size;
            }
        }
        
        return 100; // Unknown at the end
    }

    /**
     * Generates the CSS background property for a mixed strategy
     * @param {Object} freqs - e.g. { fold: 0.5, raise: 0.5, raise_7.5: 0.3 }
     */
    getBackgroundStyle(freqs) {
        if (!freqs) return this.colors['fold'];
        
        const entries = Object.entries(freqs)
            .filter(([, pct]) => pct > 0.001) // Ignore < 0.1%
            .sort((a, b) => this.getActionPriority(a[0]) - this.getActionPriority(b[0]));

        if (entries.length === 0) return this.colors['fold'];
        if (entries.length === 1) return this.getColorForAction(entries[0][0]);

        // Build Gradient
        // We accumulate percentages to create hard stops
        let gradientStops = [];
        let currentPct = 0;

        entries.forEach(([action, pct]) => {
            const color = this.getColorForAction(action);
            const endPct = currentPct + (pct * 100);
            
            gradientStops.push(`${color} ${currentPct}%`);
            gradientStops.push(`${color} ${endPct}%`);
            
            currentPct = endPct;
        });

        return `linear-gradient(to top, ${gradientStops.join(', ')})`;
    }

    renderGrid(containerId, strategyData, onHandClick, isSubsetRange = false) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const ranks = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
        let html = '<div class="gto-grid">';

        for (let row = 0; row < 13; row++) {
            html += '<div class="gto-row">';
            for (let col = 0; col < 13; col++) {
                const hand = this.getHandFromCoords(row, col, ranks);
                html += `<div class="gto-cell" id="cell-${hand}" data-hand="${hand}"></div>`;
            }
            html += '</div>';
        }
        html += '</div>';
        container.innerHTML = html;

        // Apply styles and events after rendering
        this.updateGrid(strategyData, isSubsetRange);

        // Bind events
        const cells = container.querySelectorAll('.gto-cell');
        cells.forEach(cell => {
            cell.addEventListener('click', () => {
                const hand = cell.dataset.hand;
                if (onHandClick) onHandClick(hand);
            });
            
            // Tooltip or hover effect could go here
        });
    }

    updateGrid(strategyData, isSubsetRange = false) {
        if (!strategyData) return;

        const cells = document.querySelectorAll('.gto-cell');
        cells.forEach(cell => {
            const hand = cell.dataset.hand;
            const strategy = strategyData[hand];
            
            if (strategy) {
                cell.style.background = this.getBackgroundStyle(strategy);
                cell.innerHTML = `<span class="hand-label">${hand}</span>`;
                cell.classList.remove('opacity-25', 'grayscale');
            } else {
                if (isSubsetRange) {
                    // Out of Range (Previously folded)
                    cell.style.background = this.colors['out_of_range'];
                    cell.classList.add('grayscale');
                    cell.classList.remove('opacity-25'); // Remove opacity to avoid blue background bleed
                    cell.style.opacity = '1'; 
                    cell.innerHTML = `<span class="hand-label" style="opacity: 0.3">${hand}</span>`; // Dim text instead
                } else {
                    // First action (Open/RFI) -> Missing means Fold 100%
                    cell.style.background = this.colors['fold'];
                    cell.innerHTML = `<span class="hand-label">${hand}</span>`;
                    cell.classList.remove('opacity-25', 'grayscale');
                    cell.style.opacity = '1';
                }
            }
        });
    }

    getHandFromCoords(row, col, ranks) {
        const r1 = ranks[row];
        const r2 = ranks[col];
        if (row === col) return `${r1}${r2}`;
        if (row < col) return `${r1}${r2}s`; // Suited (Row index < Col index in this visual layout usually)
        return `${r2}${r1}o`; // Offsuit
    }
}
