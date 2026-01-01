/*
 * GTO Tree Manager
 * Manages the state of the preflop action sequence and interacts with the SQLite DB.
 */
class GTOTreeManager {
    constructor(renderer, llmService) {
        this.renderer = renderer;
        this.llm = llmService;
        
        // Game Configuration
        this.config = {
            variant: 'Cash',
            tableSize: 7,
            stackDepth: 100
        };
        
        // 7-max Positions order
        this.positions = ['UTG', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
        this.stacks = {
            'UTG': 100, 'LJ': 100, 'HJ': 100, 'CO': 100, 'BTN': 100, 'SB': 99.5, 'BB': 99
        };
        
        this.db = null;
        this.editMode = false;
        this.currentTool = 'raise'; // Default tool
        this.isPainting = false;
        
        // Initial State
        this.resetTree();
    }

    resetTree() {
        this.actions = {}; // Map of Pos -> Action (e.g., UTG: 'Raise 2.5')
        this.currentPosIndex = 0; // UTG starts
        this.heroPos = null; // Who are we viewing?
    }

    async init() {
        this.renderTreeControls();
        this.updateView();
        
        // Load Database
        await this.loadDatabase();
    }

    async loadDatabase() {
        try {
            const sqlPromise = window.initSqlJs({
                locateFile: file => `lib/${file}`
            });
            const dataPromise = fetch('data/gto.db').then(res => res.arrayBuffer());
            
            const [SQL, buf] = await Promise.all([sqlPromise, dataPromise]);
            this.db = new SQL.Database(new Uint8Array(buf));
            
            console.log("Database loaded successfully");
            this.updateView(); // Refresh with DB data
            
        } catch (e) {
            console.error("Failed to load DB", e);
            alert("Could not load GTO database. Check console.");
        }
    }

    toggleEditMode() {
        this.editMode = !this.editMode;
        const btn = document.getElementById('edit-mode-btn');
        const palette = document.getElementById('paint-palette');
        
        if (btn) {
            btn.classList.toggle('text-yellow-400', this.editMode);
            btn.classList.toggle('text-gray-400', !this.editMode);
        }
        
        if (palette) {
            palette.classList.toggle('hidden', !this.editMode);
        }
        
        this.updateView();
    }
    
    setTool(tool) {
        this.currentTool = tool;
        // Update UI
        const tools = document.querySelectorAll('.palette-tool');
        tools.forEach(t => {
            const isSelected = t.dataset.tool === tool;
            if (isSelected) {
                t.classList.add('ring-2', 'ring-white', 'opacity-100');
                t.classList.remove('opacity-50');
            } else {
                t.classList.remove('ring-2', 'ring-white', 'opacity-100');
                t.classList.add('opacity-50');
            }
        });
    }

    // --- Data Retrieval ---
    getStrategyForCurrentState() {
        if (!this.db) return {}; 
        
        const activePos = this.positions[this.currentPosIndex];
        const context = this.deriveContext();
        
        return this.getStrategyForContext(activePos, context.villainPos, context.prevAction, context.isRFI);
    }

    /**
     * Fuzzy search for the closest GTO strategy based on action amount.
     * Searches database for closest matching bet size for this specific spot.
     */
    findClosestStrategy(heroPos, villainPos, actionAmountBB) {
        if (!this.db) return {};

        // 1. Get all scenarios for this position matchup
        // We only care about scenarios where we face a raise (prev_action like 'Raise %')
        const query = "SELECT id, prev_action FROM scenarios WHERE hero_pos = :hero AND villain_pos = :villain";
        const stmt = this.db.prepare(query);
        stmt.bind({ ':hero': heroPos, ':villain': villainPos });

        let bestScenarioId = null;
        let minDiff = Infinity;
        let bestMatchAction = "";

        while (stmt.step()) {
            const row = stmt.getAsObject();
            
            // Extract numeric amount from "Raise 2.5", "Raise 9", etc.
            const match = row.prev_action.match(/Raise\s+([\d\.]+)/i);
            if (match) {
                const dbAmount = parseFloat(match[1]);
                const diff = Math.abs(dbAmount - actionAmountBB);
                
                // Find the scenario with the smallest difference in bet size
                if (diff < minDiff) {
                    minDiff = diff;
                    bestScenarioId = row.id;
                    bestMatchAction = row.prev_action;
                }
            }
        }
        stmt.free();

        if (bestScenarioId) {
            console.log(`Fuzzy Match: Input ${actionAmountBB.toFixed(1)}bb -> Matched "${bestMatchAction}" (Diff: ${minDiff.toFixed(2)})`);
            return this.getStrategyByScenarioId(bestScenarioId);
        }

        return {};
    }

    /**
     * Retrieve Strategy content by ID
     */
    getStrategyByScenarioId(scenarioId) {
        const stratStmt = this.db.prepare("SELECT hand, frequencies FROM strategies WHERE scenario_id = :id");
        stratStmt.bind({ ':id': scenarioId });
        
        const strategy = {};
        while(stratStmt.step()) {
            const row = stratStmt.getAsObject();
            strategy[row.hand] = JSON.parse(row.frequencies);
        }
        stratStmt.free();
        return strategy;
    }

    /**
     * Estimate Equity for Hero vs Villain using DB Ranges
     * Fetches Villain's Opening Range from the DB itself.
     */
    async estimateEquity(heroHandStr, villainPos) {
        if (!this.db) return null;

        // 1. Fetch Villain's RFI Range from DB
        // Query: What does 'villainPos' do when they are first to act (vs Blinds/Fold)?
        // This assumes standard RFI scenarios are stored as Villain vs Blinds (Fold)
        let query = "SELECT id FROM scenarios WHERE hero_pos = :hero AND prev_action = 'Fold'";
        let params = { ':hero': villainPos };
        
        // If no simple RFI found, try to find *any* scenario where they act first
        // But 'Fold' is the standard 'prev_action' for RFI in your app logic.
        
        const stmt = this.db.prepare(query);
        stmt.bind(params);
        
        let villainScenarioId = null;
        if (stmt.step()) {
            villainScenarioId = stmt.getAsObject().id;
        }
        stmt.free();

        let villainRangeHands = [];

        if (villainScenarioId) {
            const strategy = this.getStrategyByScenarioId(villainScenarioId);
            
            // Build range: Any hand they Raise/All-in with > 5% frequency
            villainRangeHands = Object.keys(strategy).filter(hand => {
                const freqs = strategy[hand];
                if (!freqs) return false;
                const raiseFreq = (freqs.raise || 0) + (freqs.raise_all_in || 0);
                return raiseFreq > 0.05; // 5% cutoff to filter noise
            });
        }

        if (villainRangeHands.length === 0) {
            console.warn(`Could not find RFI range for ${villainPos} in DB.`);
            return null;
        }

        // 2. Calculate Equity
        // We pass the list of hands as a comma-separated string to the calculator
        const rangeStr = villainRangeHands.join(',');
        
        try {
            // Async wrapper for calculation to not freeze UI
            const result = await new Promise((resolve, reject) => {
                setTimeout(() => {
                    try {
                        // 2000 iterations is a fast estimate
                        const res = OddsCalculator.calculateRangeEquity(heroHandStr, rangeStr, '', 2000);
                        resolve(res);
                    } catch (err) {
                        reject(err);
                    }
                }, 10);
            });
            return result.range1Equity;
        } catch (e) {
            console.error("Equity Calc Failed:", e);
            return null;
        }
    }

    normalizeHand(handStr) {
        if (!handStr) return '';
        try {
            // Use PokerHand from poker-logic.js if available
            if (typeof PokerHand !== 'undefined') {
                const h = new PokerHand(handStr);
                // Convert 4s4c -> 44, AsKh -> AKo, AsKs -> AKs
                if (h.paired) {
                    const rank = h.getCardName(h.highCard);
                    return rank + rank;
                } else {
                    const r1 = h.getCardName(h.highCard);
                    const r2 = h.getCardName(h.lowCard);
                    return r1 + r2 + (h.suited ? 's' : 'o');
                }
            }
            return handStr;
        } catch (e) {
            console.warn("Hand normalization failed", e);
            return handStr;
        }
    }

    getStrategyForContext(heroPos, villainPos, prevAction, isRFI) {
        if (!this.db) return {};

        // Build Base Query with context filters
        let query = "SELECT id FROM scenarios WHERE hero_pos = :hero AND villain_pos = :villain AND prev_action = :prev";
        let params = {
            ':hero': heroPos,
            ':villain': villainPos,
            ':prev': prevAction
        };

        // RFI overrides
        if (isRFI) {
             query = "SELECT id FROM scenarios WHERE hero_pos = :hero AND villain_pos = 'Blinds' AND prev_action = 'Fold'";
             params = { ':hero': heroPos };
        }
        
        const stmt = this.db.prepare(query);
        stmt.bind(params);
        
        let scenarioId = null;
        if (stmt.step()) {
            const row = stmt.getAsObject();
            scenarioId = row.id;
        }
        stmt.free();

        if (scenarioId) {
            return this.getStrategyByScenarioId(scenarioId);
        } else {
            return {};
        }
    }

    deriveContext() {
        const history = this.getActionHistory();
        
        // RFI Check: No raises before me
        const lastAggressor = history.slice().reverse().find(a => a.action.includes('Raise') || a.action.includes('Allin'));
        
        if (!lastAggressor) {
            return { isRFI: true, villainPos: 'Blinds', prevAction: 'Fold' };
        } else {
            // Vs Open
            return { 
                isRFI: false, 
                villainPos: lastAggressor.pos, 
                prevAction: lastAggressor.action 
            };
        }
    }

    // --- Edit Logic ---
    applyToolStrategy() {
        switch(this.currentTool) {
            case 'raise': return { raise: 1.0 };
            case 'call': return { call: 1.0 };
            case 'fold': return { fold: 1.0 };
            case 'allin': return { raise_all_in: 1.0 };
            case 'mix_raise_call': return { raise: 0.5, call: 0.5 };
            case 'mix_fold_raise': return { fold: 0.5, raise: 0.5 };
            case 'mix_fold_call': return { fold: 0.5, call: 0.5 };
            case 'mix_fold_call_raise': return { fold: 0.33, call: 0.33, raise: 0.34 };
            default: return { fold: 1.0 };
        }
    }

    updateHandStrategy(hand) {
        if (!this.editMode || !this.db) return;

        // Current Context
        const activePos = this.positions[this.currentPosIndex];
        const context = this.deriveContext();
        
        // Ensure Scenario Exists (Create if not)
        let scenarioId = this.getOrCreateScenarioId(activePos, context);
        
        // Use Tool Strategy
        const newStrat = this.applyToolStrategy();
        
        // Update DB
        this.db.run(`INSERT OR REPLACE INTO strategies (scenario_id, hand, frequencies) VALUES (?, ?, ?)`, 
                    [scenarioId, hand, JSON.stringify(newStrat)]);
        
        // Mark unsaved
        this.hasUnsavedChanges = true;
        this.updateSaveButtonState();
        
        // Force refresh UI
        this.updateView();
        
        // Trigger Save immediately (Debounced)
        this.debouncedSave();
    }
    
    // Add debounce helper in constructor or class property
    debouncedSave() {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.hasUnsavedChanges = true;
        this.updateSaveButtonState();
        
        this.saveTimeout = setTimeout(() => {
            this.saveDatabase();
        }, 1000); // Save 1 second after last edit
    }
    
    updateSaveButtonState() {
        const btn = document.getElementById('save-db-btn');
        if (btn && this.hasUnsavedChanges) {
            btn.classList.add('text-red-500', 'animate-pulse');
            btn.title = "Unsaved Changes! Click to Download.";
        } else if (btn) {
            btn.classList.remove('text-red-500', 'animate-pulse');
            btn.title = "Save Database";
        }
    }
    
    getOrCreateScenarioId(hero, ctx) {
        // Try find
        let stmt;
        let query, params;
        
        if (ctx.isRFI) {
            query = "SELECT id FROM scenarios WHERE hero_pos = ? AND villain_pos = 'Blinds' AND prev_action = 'Fold'";
            params = [hero];
        } else {
            query = "SELECT id FROM scenarios WHERE hero_pos = ? AND villain_pos = ? AND prev_action = ?";
            params = [hero, ctx.villainPos, ctx.prevAction];
        }
        
        const res = this.db.exec(query, params);
        if (res.length > 0 && res[0].values.length > 0) {
             return res[0].values[0][0];
        }
        
        // Create
        const name = `${hero} vs ${ctx.villainPos || 'Blinds'} (${ctx.prevAction})`;
        this.db.run("INSERT INTO scenarios (name, hero_pos, villain_pos, prev_action, pot_type) VALUES (?, ?, ?, ?, ?)",
                    [name, hero, ctx.villainPos || 'Blinds', ctx.prevAction, 'SRP']);
        
        // Return new ID
        const lastIdRes = this.db.exec("SELECT last_insert_rowid()");
        return lastIdRes[0].values[0][0];
    }
    
    getHandStrat(scenarioId, hand) {
        const res = this.db.exec("SELECT frequencies FROM strategies WHERE scenario_id = ? AND hand = ?", [scenarioId, hand]);
        if (res.length > 0 && res[0].values.length > 0) {
            return JSON.parse(res[0].values[0][0]);
        }
        return { fold: 1.0 }; // Default
    }

    async saveDatabase() {
        if (!this.db) return;
        const data = this.db.export();
        const blob = new Blob([data], { type: 'application/x-sqlite3' });
        
        try {
            const btn = document.getElementById('save-db-btn');
            if (btn) btn.textContent = '⏳'; // Saving state
            
            const response = await fetch('/save-db', {
                method: 'POST',
                body: blob,
                headers: {
                    'Content-Type': 'application/x-sqlite3'
                }
            });

            if (response.ok) {
                console.log("Database auto-saved to server");
                this.hasUnsavedChanges = false;
                this.updateSaveButtonState();
                if (btn) {
                    btn.textContent = '✅'; 
                    setTimeout(() => btn.textContent = '💾', 1000);
                }
            } else {
                throw new Error("Server rejected save");
            }
        } catch (e) {
            console.error("Auto-save failed:", e);
            // Fallback to download if server fails
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'gto.db';
            a.click();
            alert("Server save failed. Downloading file instead.");
        }
    }

    // --- Tree Navigation (Same as before) ---
    getActionHistory() {
        return this.positions
            .slice(0, this.currentPosIndex)
            .map(p => ({ pos: p, action: this.actions[p] || 'Fold' }))
            .filter(a => a.action !== 'Fold');
    }

    handleAction(pos, action) {
        this.actions[pos] = action;
        if (this.currentPosIndex < this.positions.length - 1) {
            this.currentPosIndex++;
        }
        this.updateView();
    }

    resetTo(posIndex) {
        for (let i = posIndex; i < this.positions.length; i++) {
            delete this.actions[this.positions[i]];
        }
        this.currentPosIndex = posIndex;
        this.updateView();
    }

    // --- Copy/Paste Logic ---
    copyCurrentRange() {
        const strategy = this.getStrategyForCurrentState();
        if (Object.keys(strategy).length === 0) {
            alert("No range to copy!");
            return;
        }
        localStorage.setItem('poker_copied_range', JSON.stringify(strategy));
        
        // Visual feedback
        const btn = document.getElementById('copy-range-btn');
        if(btn) {
            const original = btn.textContent;
            btn.textContent = '✅';
            setTimeout(() => btn.textContent = original, 1000);
        }
    }

    pasteRange() {
        if (!this.editMode) {
            alert("Please enable Edit Mode (✏️) to paste ranges.");
            return;
        }
        
        const raw = localStorage.getItem('poker_copied_range');
        if (!raw) {
            alert("Clipboard empty!");
            return;
        }
        
        try {
            const strategy = JSON.parse(raw);
            
            // Apply to current scenario
            const activePos = this.positions[this.currentPosIndex];
            const context = this.deriveContext();
            const scenarioId = this.getOrCreateScenarioId(activePos, context);
            
            // Bulk insert/update
            // SQLite doesn't support bulk JSON insert easily in one query without constructing a huge string
            // We'll iterate. Transaction would be faster.
            
            this.db.exec("BEGIN TRANSACTION");
            const stmt = this.db.prepare("INSERT OR REPLACE INTO strategies (scenario_id, hand, frequencies) VALUES (?, ?, ?)");
            
            for (const [hand, freqs] of Object.entries(strategy)) {
                stmt.run([scenarioId, hand, JSON.stringify(freqs)]);
            }
            
            stmt.free();
            this.db.exec("COMMIT");
            
            this.debouncedSave();
            this.updateView();
            
            // Visual feedback
            const btn = document.getElementById('paste-range-btn');
            if(btn) {
                const original = btn.textContent;
                btn.textContent = '✅';
                setTimeout(() => btn.textContent = original, 1000);
            }
            
        } catch (e) {
            console.error("Paste failed", e);
            alert("Failed to paste range: " + e.message);
        }
    }

    // --- Rendering ---
    renderTreeControls() {
        const container = document.getElementById('tree-controls');
        if (!container) return;

        // Render columns for each position
        // Filter out BB if no raise has occurred yet (RFI phase)
        const history = this.getActionHistory();
        const hasRaise = history.some(a => a.action.includes('Raise') || a.action.includes('Allin'));
        
        let visiblePositions = this.positions;
        if (!hasRaise) {
             visiblePositions = this.positions.filter(p => p !== 'BB');
        }

        container.innerHTML = visiblePositions.map((pos, index) => {
            // Adjust index to match visible positions if needed, but currentPosIndex tracks logic index
            // We need to map visual index to logical index if we hide elements?
            // Actually, we just hide the BB if it's the last one and no one raised.
            // But wait, the loop runs on visiblePositions.
            // If we filter, we might lose the connection to 'index' being the position index in this.positions.
            
            // Better: Loop all, return empty if hidden.
            if (pos === 'BB' && !hasRaise) return '';

            const isActive = this.positions.indexOf(pos) === this.currentPosIndex;
            const action = this.actions[pos];
            const stack = this.stacks[pos];
            
            // Logic for available actions based on previous action
            let prevBet = 1; // BB
            if (index > 0) {
                // Find last bet
                // But simplified: check action history
                // Actually, we just need to know if we are facing a raise.
                // If previous action was a Raise, our raise options should be bigger (3-bet sizing).
            }
            
            // Simple history check
            const history = this.getActionHistory();
            const lastAggressor = history.slice().reverse().find(a => a.action.includes('Raise') || a.action.includes('Allin'));
            
            let raiseLabel = 'Raise 2.5';
            let raiseValue = 'Raise 2.5';
            
            // If facing a raise, next raise is a 3-bet (approx 3x)
            if (lastAggressor) {
                // If 2.5 -> 3bet to ~7.5 or 9
                // Simplified logic from screenshot: 2 -> 6.5 -> 14 -> 25
                if (lastAggressor.action.includes('2.5') || lastAggressor.action.includes('2')) {
                    raiseLabel = 'Raise 9'; 
                    raiseValue = 'Raise 9';
                } else if (lastAggressor.action.includes('9') || lastAggressor.action.includes('6.5')) {
                    raiseLabel = 'Raise 22'; // 4-bet
                    raiseValue = 'Raise 22';
                } else if (lastAggressor.action.includes('22') || lastAggressor.action.includes('14')) {
                    raiseLabel = 'Raise 45'; // 5-bet
                    raiseValue = 'Raise 45';
                }
            } else {
                // RFI logic
                // UTG-BTN: 2.5x is standard 100bb online. Live might be larger.
                // SB RFI vs BB is usually 3x.
                if (pos === 'SB') {
                    raiseLabel = 'Raise 3';
                    raiseValue = 'Raise 3';
                }
            }

            let content = '';
            
            if (isActive) {
                // Active Step
                content = `
                    <div class="space-y-1 relative z-10">
                        <button class="w-full text-left text-xs py-1 px-2 hover:bg-gray-700 bg-gray-900/50 rounded text-gray-400 border border-transparent hover:border-gray-500 transition-colors" onclick="treeManager.handleAction('${pos}', 'Fold')">Fold</button>
                        <button class="w-full text-left text-xs py-1 px-2 hover:bg-gray-700 bg-gray-900/50 rounded text-green-400 font-bold border border-transparent hover:border-green-500 transition-colors" onclick="treeManager.handleAction('${pos}', 'Call')">Call</button>
                        <button class="w-full text-left text-xs py-1 px-2 hover:bg-gray-700 bg-gray-900/50 rounded text-red-400 font-bold border border-transparent hover:border-red-500 transition-colors" onclick="treeManager.handleAction('${pos}', '${raiseValue}')">${raiseLabel}</button>
                        <button class="w-full text-left text-xs py-1 px-2 hover:bg-gray-700 bg-gray-900/50 rounded text-red-600 font-bold border border-transparent hover:border-red-700 transition-colors" onclick="treeManager.handleAction('${pos}', 'Allin 100')">Allin</button>
                    </div>
                `;
            } else if (action) {
                // Completed Step
                let colorClass = 'text-gray-400'; // Fold
                if (action.includes('Raise')) colorClass = 'text-red-400';
                if (action.includes('Call')) colorClass = 'text-green-400';
                if (action.includes('Allin')) colorClass = 'text-red-600';
                
                content = `<div class="text-sm font-bold ${colorClass} mt-2">${action}</div>`;
            } else {
                content = `<div class="text-xs text-gray-600 mt-2">Waiting...</div>`;
            }

            return `
                <div class="flex-1 min-w-[80px] bg-gray-800 border ${isActive ? 'border-primary ring-1 ring-primary' : 'border-gray-700'} rounded p-2 flex flex-col gap-1 ${isActive ? '' : 'cursor-pointer'}" onclick="${isActive ? '' : `treeManager.resetTo(${this.positions.indexOf(pos)})`}">
                    <div class="flex justify-between items-center border-b border-gray-700 pb-1">
                        <span class="font-bold text-sm text-gray-200">${pos}</span>
                        <span class="text-xs text-gray-500">${stack}bb</span>
                    </div>
                    ${content}
                </div>
            `;
        }).join('');
    }

    updateView() {
        this.renderTreeControls();

        const activePos = this.positions[this.currentPosIndex];
        const strategy = this.getStrategyForCurrentState();
        
        // Render Grid with click handler routing
        this.renderer.renderGrid('gto-grid-container', strategy, (hand) => {
            if (this.editMode) {
                this.updateHandStrategy(hand);
            } else {
                this.selectHand(hand, strategy);
            }
        });

        // Update Titles
        const titleEl = document.getElementById('current-scenario-title');
        if (titleEl) {
            const history = this.getActionHistory().map(a => `${a.pos} ${a.action}`).join(', ');
            titleEl.innerHTML = `
                <span class="text-primary">${activePos}</span> Decision 
                <span class="text-xs font-normal text-gray-500 block">${history || 'RFI Strategy'}</span>
                ${this.editMode ? '<span class="text-yellow-400 text-xs font-bold">[EDIT MODE] Click hands to cycle</span>' : ''}
            `;
        }
    }

    selectHand(hand, strategy) {
        const data = strategy[hand];
        const infoPanel = document.getElementById('hand-info-content');
        if (infoPanel) {
            infoPanel.innerHTML = `
                <h3 class="text-xl font-bold mb-2">${hand}</h3>
                <div class="space-y-2">
                    ${this.formatFrequencies(data)}
                </div>
            `;
        }
        
        if (document.getElementById('auto-analyze')?.checked) {
             const context = {
                scenarioName: this.getActionHistory().map(a => a.pos).join('_') + `_to_${this.positions[this.currentPosIndex]}`,
                heroPos: this.positions[this.currentPosIndex],
                hand: hand,
                strategy: data
            };
            this.llm.analyze(context).then(res => {
                const out = document.getElementById('coach-response');
                if(out) out.innerHTML = res.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
            });
        }
    }

    formatFrequencies(freqs) {
        if (!freqs) return 'Fold 100%';
        const colors = this.renderer.colors;
        return Object.entries(freqs)
            .sort(([,a], [,b]) => b - a)
            .map(([action, val]) => `
                <div class="flex justify-between text-sm">
                    <span class="capitalize text-gray-300">${action.replace('_', ' ')}</span>
                    <span class="font-mono font-bold">${(val * 100).toFixed(1)}%</span>
                </div>
                <div class="w-full bg-gray-700 h-2 rounded mt-1">
                    <div class="h-full rounded" style="width: ${val * 100}%; background-color: ${colors[action] || '#fff'}"></div>
                </div>
            `).join('');
    }
}

// Global instance
let treeManager;

document.addEventListener('DOMContentLoaded', () => {
    const renderer = new GTORenderer();
    const llm = new LLMService();
    
    treeManager = new GTOTreeManager(renderer, llm);
    window.treeManager = treeManager;
    treeManager.init();
    
    // Bind Edit/Save buttons if they exist
    const editBtn = document.getElementById('edit-mode-btn');
    if (editBtn) editBtn.addEventListener('click', () => treeManager.toggleEditMode());
    
    const saveBtn = document.getElementById('save-db-btn');
    if (saveBtn) saveBtn.addEventListener('click', () => treeManager.saveDatabase());

    // Bind Copy/Paste
    const copyBtn = document.getElementById('copy-range-btn');
    if (copyBtn) copyBtn.addEventListener('click', () => treeManager.copyCurrentRange());
    
    const pasteBtn = document.getElementById('paste-range-btn');
    if (pasteBtn) pasteBtn.addEventListener('click', () => treeManager.pasteRange());

    // Bind Paint Palette Tools
    const tools = document.querySelectorAll('.palette-tool');
    tools.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tool = e.target.dataset.tool;
            treeManager.setTool(tool);
        });
    });
});
