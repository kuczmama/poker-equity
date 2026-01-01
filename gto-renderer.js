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
            'raise': '#b93c3c',     // Red (Raise)
            'raise_small': '#b93c3c', // Red (Small Raise)
            'raise_big': '#8a2323', // Darker Red (Big Raise/3bet)
            'all_in': '#6d1b1b',     // Deep Red (All-in)
            'raise_all_in': '#6d1b1b', // Ensure tree-manager key matches
            'out_of_range': '#000000' // Pure Black
        };
    }

    /**
     * Generates the CSS background property for a mixed strategy
     * @param {Object} freqs - e.g. { fold: 0.5, raise: 0.5 }
     */
    getBackgroundStyle(freqs) {
        if (!freqs) return this.colors['fold'];

        // Sort actions by priority for consistent stacking
        // Standard GTO Wiz stacking: Fold (bottom), Call, Raise (top)
        const priority = ['out_of_range', 'fold', 'call', 'raise', 'raise_small', 'raise_big', 'all_in', 'raise_all_in'];
        
        const entries = Object.entries(freqs)
            .filter(([, pct]) => pct > 0.001) // Ignore < 0.1%
            .sort((a, b) => priority.indexOf(a[0]) - priority.indexOf(b[0]));

        if (entries.length === 0) return this.colors['fold'];
        if (entries.length === 1) return this.colors[entries[0][0]] || this.colors['fold'];

        // Build Gradient
        // We accumulate percentages to create hard stops
        let gradientStops = [];
        let currentPct = 0;

        entries.forEach(([action, pct]) => {
            const color = this.colors[action] || '#333';
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
