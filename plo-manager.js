class PLOManager {
    constructor() {
        this.data = [];
        this.mockUrl = 'data/plo-sample.json';
    }

    async init() {
        await this.loadData();
        this.render();
    }

    async loadData() {
        try {
            const res = await fetch(this.mockUrl);
            this.data = await res.json();
        } catch (e) {
            console.error("Failed to load PLO data", e);
        }
    }

    formatHand(combo) {
        // Parse [AT][AT] to nice HTML
        // Simple formatter for now:
        // Replace [...] blocks with styled spans with a tiny margin
        return combo.replace(/\[(.*?)\]/g, '<span class="bg-gray-700 px-1 rounded text-white mr-0.5">$1</span>');
    }

    render() {
        const container = document.getElementById('plo-ranges-container');
        if (!container) return;

        // We want 3 columns (Fold, Call, Pot) - or dynamic based on actions found
        // For the mock, we know it's Fold, Call, Pot.
        const actions = ['Fold', 'Call', 'Pot'];
        
        let html = '<div class="grid grid-cols-1 md:grid-cols-3 gap-4 h-full">';
        
        actions.forEach(action => {
            // Filter hands that have this action > 0%
            // Sort by frequency of this action desc
            const relevantHands = this.data
                .filter(d => d.strategy && d.strategy[action] > 0)
                .sort((a, b) => b.strategy[action] - a.strategy[action]);

            // Calculate aggregate frequency
            // In real app this would be weighted sum / total weight
            const totalFreq = relevantHands.length > 0 ? "33%" : "0%"; // Placeholder

            html += `
                <div class="flex flex-col bg-gray-800 rounded-lg border border-gray-700 overflow-hidden h-full">
                    <div class="p-2 bg-gray-900 border-b border-gray-700 flex justify-between items-center sticky top-0 z-10">
                        <span class="font-bold text-${this.getActionColor(action)}-400">${action}</span>
                        <span class="text-xs text-gray-500">${totalFreq}</span>
                    </div>
                    <div class="overflow-y-auto flex-1 p-0">
                        <table class="w-full text-xs text-left">
                            <thead class="bg-gray-900/50 text-gray-400 sticky top-0">
                                <tr>
                                    <th class="p-2">Hand</th>
                                    <th class="p-2 text-right">Freq</th>
                                    <th class="p-2 text-right">EV</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-700">
                                ${relevantHands.map(h => `
                                    <tr class="hover:bg-gray-700/50 transition-colors">
                                        <td class="p-2 font-mono text-gray-200">${this.formatHand(h.combo)}</td>
                                        <td class="p-2 text-right font-bold text-${this.getActionColor(action)}-400">${h.strategy[action]}%</td>
                                        <td class="p-2 text-right text-gray-500">${h.ev.toFixed(2)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        });
        
        html += '</div>';
        container.innerHTML = html;
    }

    getActionColor(action) {
        switch(action.toLowerCase()) {
            case 'fold': return 'blue';
            case 'call': return 'green';
            case 'pot': return 'red';
            case 'raise': return 'red';
            default: return 'gray';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.ploManager = new PLOManager();
    window.ploManager.init();
});

