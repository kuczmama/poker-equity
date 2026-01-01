/**
 * GTO Manager
 * Handles data fetching (Mock or SQLite) and state management
 */
class GTOManager {
    constructor() {
        this.renderer = new GTORenderer();
        this.llm = new LLMService();
        this.db = null;
        this.currentScenario = null;
        this.scenarios = [];
        
        // Mock Data for "BTN Open" to start with
        this.mockData = {
            'BTN Open': this.generateMockStrategy('BTN'),
            'UTG Open': this.generateMockStrategy('UTG'),
            'SB vs BB': this.generateMockStrategy('SB')
        };
    }

    async init() {
        // Initialize UI
        this.renderScenarioSelector();
        
        // Load default mock scenario
        this.loadScenario('BTN Open');

        // Check for API Key
        this.updateAuthStatus();

        // TODO: SQL.js Integration
        // 1. Load sql-wasm.js
        // 2. Fetch 'data/gto.db'
        // 3. const db = new SQL.Database(new Uint8Array(buffer));
        // 4. db.exec("SELECT * FROM scenarios");
    }

    generateMockStrategy(pos) {
        const ranks = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
        const strategy = {};

        // Simple heuristic generation for visual testing
        for (let i = 0; i < 13; i++) {
            for (let j = 0; j < 13; j++) {
                const r1 = ranks[i];
                const r2 = ranks[j];
                let hand = i < j ? `${r1}${r2}s` : (i === j ? `${r1}${r2}` : `${r2}${r1}o`);
                
                // Logic to make it look real
                let freq = { fold: 1.0 };
                
                if (pos === 'BTN') {
                    // BTN opens wide
                    if (i === j) { // Pairs
                        if (i < 9) freq = { raise: 1.0 }; // 22+
                        else freq = { raise: 0.5, fold: 0.5 };
                    } else if (i < j) { // Suited
                        if (i < 5 || (i < 9 && j < 10)) freq = { raise: 1.0 };
                        else if (i < 11 && j < 12) freq = { raise: 0.4, fold: 0.6 };
                    } else { // Offsuit
                        if (i < 3 && j < 5) freq = { raise: 1.0 }; // AK, AQ
                        else if (i < 4 && j < 8) freq = { raise: 0.2, fold: 0.8 };
                    }
                } else if (pos === 'UTG') {
                    // Tight
                     if (i === j) { // Pairs
                        if (i < 7) freq = { raise: 1.0 }; // 77+
                        else freq = { fold: 1.0 };
                    } else if (i < j) { // Suited
                        if (i < 3) freq = { raise: 1.0 }; // AJs+
                        else freq = { fold: 1.0 };
                    } else { // Offsuit
                        if (i < 2 && j < 3) freq = { raise: 1.0 }; // AK, AQ
                        else freq = { fold: 1.0 };
                    }
                }
                
                strategy[hand] = freq;
            }
        }
        return strategy;
    }

    renderScenarioSelector() {
        const selector = document.getElementById('scenario-select');
        if (!selector) return;

        const opts = Object.keys(this.mockData);
        selector.innerHTML = opts.map(k => `<option value="${k}">${k}</option>`).join('');
        
        selector.addEventListener('change', (e) => {
            this.loadScenario(e.target.value);
        });
    }

    loadScenario(name) {
        this.currentScenario = name;
        const data = this.mockData[name];
        
        this.renderer.renderGrid('gto-grid-container', data, (hand) => {
            this.selectHand(hand);
        });

        document.getElementById('current-scenario-title').innerText = name;
    }

    selectHand(hand) {
        const data = this.mockData[this.currentScenario][hand];
        
        // Update Info Panel
        const infoPanel = document.getElementById('hand-info-content');
        if (infoPanel) {
            infoPanel.innerHTML = `
                <h3 class="text-xl font-bold mb-2">${hand}</h3>
                <div class="space-y-2">
                    ${this.formatFrequencies(data)}
                </div>
            `;
        }

        // Trigger LLM if enabled
        if (document.getElementById('auto-analyze').checked) {
            this.askCoach(hand, data);
        }
    }

    formatFrequencies(freqs) {
        return Object.entries(freqs)
            .sort(([,a], [,b]) => b - a)
            .map(([action, val]) => `
                <div class="flex justify-between text-sm">
                    <span class="capitalize text-gray-300">${action.replace('_', ' ')}</span>
                    <span class="font-mono font-bold">${(val * 100).toFixed(1)}%</span>
                </div>
                <div class="w-full bg-gray-700 h-2 rounded mt-1">
                    <div class="h-full rounded" style="width: ${val * 100}%; background-color: ${this.renderer.colors[action] || '#fff'}"></div>
                </div>
            `).join('');
    }

    async askCoach(hand, strategy) {
        const output = document.getElementById('coach-response');
        if (!this.llm.hasApiKey()) {
            output.innerHTML = '<p class="text-yellow-500">Please enter your OpenRouter API Key in settings to get AI analysis.</p>';
            return;
        }

        output.innerHTML = '<p class="animate-pulse text-gray-400">Thinking...</p>';

        try {
            const context = {
                scenarioName: this.currentScenario,
                heroPos: this.currentScenario.split(' ')[0], // Rough inference
                hand: hand,
                strategy: strategy
            };
            
            const advice = await this.llm.analyze(context);
            // Simple markdown parsing
            const formatted = advice.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
            output.innerHTML = formatted;
        } catch (e) {
            output.innerHTML = `<p class="text-red-500">Error: ${e.message}</p>`;
        }
    }

    updateAuthStatus() {
        const btn = document.getElementById('settings-btn');
        if (this.llm.hasApiKey()) {
            btn.classList.add('text-green-400');
        } else {
            btn.classList.remove('text-green-400');
        }
    }
}

