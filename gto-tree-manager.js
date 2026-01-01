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
        // Initialize steps with the standard order
        this.steps = this.positions.map(p => ({ pos: p, action: null }));
        this.currentStepIndex = 0;
        this.heroPos = null; 
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
        
        // Use current step's position
        const activeStep = this.steps[this.currentStepIndex];
        if (!activeStep) return {};
        
        const activePos = activeStep.pos;
        const context = this.deriveContext();
        
        return this.getStrategyForContext(activePos, context.villainPos, context.prevAction, context.isRFI);
    }

    /**
     * Fuzzy search for the closest GTO strategy based on action amount.
     */
    findClosestStrategy(heroPos, villainPos, actionAmountBB) {
        if (!this.db) return {};

        const query = "SELECT id, prev_action FROM scenarios WHERE hero_pos = :hero AND villain_pos = :villain";
        const stmt = this.db.prepare(query);
        stmt.bind({ ':hero': heroPos, ':villain': villainPos });

        let bestScenarioId = null;
        let minDiff = Infinity;
        let bestMatchAction = "";

        while (stmt.step()) {
            const row = stmt.getAsObject();
            const match = row.prev_action.match(/Raise\s+([\d\.]+)/i);
            if (match) {
                const dbAmount = parseFloat(match[1]);
                const diff = Math.abs(dbAmount - actionAmountBB);
                
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

    async estimateEquity(heroHandStr, villainPos) {
        if (!this.db) return null;

        let query = "SELECT id FROM scenarios WHERE hero_pos = :hero AND prev_action = 'Fold'";
        let params = { ':hero': villainPos };
        
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
            villainRangeHands = Object.keys(strategy).filter(hand => {
                const freqs = strategy[hand];
                if (!freqs) return false;
                const raiseFreq = (freqs.raise || 0) + (freqs.raise_all_in || 0);
                return raiseFreq > 0.05;
            });
        }

        if (villainRangeHands.length === 0) return null;

        const rangeStr = villainRangeHands.join(',');
        
        try {
            const result = await new Promise((resolve, reject) => {
                setTimeout(() => {
                    try {
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

    getStrategyForContext(heroPos, villainPos, prevAction, isRFI) {
        if (!this.db) return {};

        let query = "SELECT id FROM scenarios WHERE hero_pos = :hero AND villain_pos = :villain AND prev_action = :prev";
        let params = {
            ':hero': heroPos,
            ':villain': villainPos,
            ':prev': prevAction
        };

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

    deriveContext(atIndex) {
        // Look at history up to current step (or atIndex if provided)
        const targetIndex = (typeof atIndex !== 'undefined') ? atIndex : this.currentStepIndex;
        
        const history = this.getActionHistory(targetIndex);
        
        // Find the last Aggressor
        const lastAggressor = history.slice().reverse().find(a => a.action.includes('Raise') || a.action.includes('Allin'));
        
        if (!lastAggressor) {
            return { isRFI: true, villainPos: 'Blinds', prevAction: 'Fold' };
        } else {
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
            case 'mix_out_call': return { out_of_range: 0.5, call: 0.5 };
            case 'mix_out_fold': return { out_of_range: 0.5, fold: 0.5 };
            case 'delete': return null; // Signal to delete
            default: return { fold: 1.0 };
        }
    }

    updateHandStrategy(hand) {
        if (!this.editMode || !this.db) return;

        const activeStep = this.steps[this.currentStepIndex];
        const activePos = activeStep.pos;
        const context = this.deriveContext();
        
        let scenarioId = this.getOrCreateScenarioId(activePos, context);
        const newStrat = this.applyToolStrategy();
        
        if (newStrat === null) {
            // Delete mode
            this.db.run(`DELETE FROM strategies WHERE scenario_id = ? AND hand = ?`, [scenarioId, hand]);
        } else {
            // Update mode
            this.db.run(`INSERT OR REPLACE INTO strategies (scenario_id, hand, frequencies) VALUES (?, ?, ?)`, 
                        [scenarioId, hand, JSON.stringify(newStrat)]);
        }
        
        this.hasUnsavedChanges = true;
        this.updateSaveButtonState();
        this.updateView();
        this.debouncedSave();
    }
    
    debouncedSave() {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.hasUnsavedChanges = true;
        this.updateSaveButtonState();
        
        this.saveTimeout = setTimeout(() => {
            this.saveDatabase();
        }, 1000);
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
        
        const name = `${hero} vs ${ctx.villainPos || 'Blinds'} (${ctx.prevAction})`;
        this.db.run("INSERT INTO scenarios (name, hero_pos, villain_pos, prev_action, pot_type) VALUES (?, ?, ?, ?, ?)",
                    [name, hero, ctx.villainPos || 'Blinds', ctx.prevAction, 'SRP']);
        
        const lastIdRes = this.db.exec("SELECT last_insert_rowid()");
        return lastIdRes[0].values[0][0];
    }
    
    async saveDatabase() {
        if (!this.db) return;
        const data = this.db.export();
        const blob = new Blob([data], { type: 'application/x-sqlite3' });
        
        try {
            const btn = document.getElementById('save-db-btn');
            if (btn) btn.textContent = '⏳';
            
            const response = await fetch('/save-db', {
                method: 'POST',
                body: blob,
                headers: { 'Content-Type': 'application/x-sqlite3' }
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
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'gto.db';
            a.click();
            alert("Server save failed. Downloading file instead.");
        }
    }

    // --- Tree Navigation ---
    getActionHistory(atIndex) {
        const targetIndex = (typeof atIndex !== 'undefined') ? atIndex : this.currentStepIndex;
        // Returns valid actions taken so far (excluding current pending step)
        return this.steps
            .slice(0, targetIndex)
            .filter(s => s.action && s.action !== 'Fold' && s.action !== 'None');
    }

    handleAction(stepIndex, pos, action) {
        // 1. Update the action at the specified step
        this.steps[stepIndex] = { pos, action };
        
        // 2. Truncate any future steps (changing history invalidates the future)
        this.steps = this.steps.slice(0, stepIndex + 1);
        
        // 3. Move current focus to next possible step
        this.currentStepIndex = stepIndex + 1;
        
        // 4. Ensure we have the base positions filled if we haven't completed the first orbit
        while (this.steps.length < this.positions.length) {
            const nextPos = this.positions[this.steps.length];
            this.steps.push({ pos: nextPos, action: null });
        }
        
        // 5. Dynamic Tree Extension (Ping-Pong Logic)
        // If a Raise/Allin occurred, we need to check if it's a 3-bet/4-bet that requires a response
        // from a previous aggressor.
        if (action.includes('Raise') || action.includes('Allin')) {
            // Get all active actions including the one we just made
            const activeSteps = this.steps.filter(s => s.action && s.action !== 'Fold');
            const raisers = activeSteps.filter(s => s.action.includes('Raise') || s.action.includes('Allin'));
            
            // If there are 2 or more raisers, the action bounces back to the previous aggressor
            if (raisers.length >= 2) {
                // Example: HJ Raise, BB Raise. 
                // raisers = [HJ, BB]. We just processed BB.
                // Previous aggressor is HJ.
                const previousAggressor = raisers[raisers.length - 2];
                
                // Append a new decision step for the previous aggressor
                this.steps.push({ pos: previousAggressor.pos, action: null });
            }
        }
        
        this.updateView();
    }

    resetTo(stepIndex) {
        // Just change the focus to the clicked step, allowing re-selection
        this.currentStepIndex = stepIndex;
        // We don't truncate yet; truncation happens when an action is selected.
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
            const activeStep = this.steps[this.currentStepIndex];
            const activePos = activeStep.pos;
            const context = this.deriveContext();
            const scenarioId = this.getOrCreateScenarioId(activePos, context);
            
            this.db.exec("BEGIN TRANSACTION");
            const stmt = this.db.prepare("INSERT OR REPLACE INTO strategies (scenario_id, hand, frequencies) VALUES (?, ?, ?)");
            for (const [hand, freqs] of Object.entries(strategy)) {
                stmt.run([scenarioId, hand, JSON.stringify(freqs)]);
            }
            stmt.free();
            this.db.exec("COMMIT");
            
            this.debouncedSave();
            this.updateView();
            
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

    importPreviousRange() {
        if (!this.editMode) {
            alert("Please enable Edit Mode (✏️) to import ranges.");
            return;
        }

        const activeStep = this.steps[this.currentStepIndex];
        const activePos = activeStep.pos;

        // Find the LAST step where this player acted
        // Iterate backwards from current step - 1
        let prevStepIndex = -1;
        for (let i = this.currentStepIndex - 1; i >= 0; i--) {
            if (this.steps[i].pos === activePos) {
                prevStepIndex = i;
                break;
            }
        }

        if (prevStepIndex === -1) {
            alert(`No previous action found for ${activePos}. Cannot import range.`);
            return;
        }

        // Get context and strategy for that previous step
        const prevContext = this.deriveContext(prevStepIndex);
        const oldStrategy = this.getStrategyForContext(activePos, prevContext.villainPos, prevContext.prevAction, prevContext.isRFI);

        if (Object.keys(oldStrategy).length === 0) {
            alert("Previous strategy is empty/undefined.");
            return;
        }

        // Transform Strategy
        const newStrategy = {};
        for (const [hand, freqs] of Object.entries(oldStrategy)) {
            const foldFreq = freqs.fold || 0;
            const activeFreq = 1.0 - foldFreq;

            if (foldFreq > 0.99) {
                // Was 100% Fold -> Now 100% Out
                // We can either delete it or set out_of_range explicitly. 
                // Setting explicitly ensures it paints black.
                // Actually, if we delete it, it paints black IF isSubsetRange is true.
                // But explicitly setting it allows mixing.
                // Let's set it explicitly if we want to support mixed "Out".
                // But wait, "delete" tool deletes row.
                // If row deleted, renderer checks "isSubsetRange".
                // So if we just don't add it to newStrategy, it will be deleted from DB?
                // No, we need to overwrite the DB for the CURRENT scenario.
                // So we construct newStrategy map, and then we need to apply it.
                // If we omit a hand from newStrategy that IS in oldStrategy, that's fine for construction.
                // But when saving to DB, we should probably clear the current scenario first or use Replace.
                
                // Let's stick to using 'out_of_range' key if we want to be explicit, 
                // OR rely on the renderer's "missing = black" logic.
                // Renderer logic: if (strategy) { ... } else { if isSubsetRange ... black }
                // So if we don't save the hand, it will be black.
                // So we just SKIP adding it to newStrategy?
                // Yes.
                continue; 
            } else if (activeFreq > 0.99) {
                // Was 100% Raise/Call -> Now 100% Active (Default Fold?)
                // User didn't specify what active part becomes. Default to Fold (Blue).
                newStrategy[hand] = { fold: 1.0 };
            } else {
                // Mixed Fold/Active
                // e.g. Fold 0.5, Raise 0.5
                // New: Out 0.5, Fold 0.5
                newStrategy[hand] = {
                    out_of_range: foldFreq,
                    fold: activeFreq
                };
            }
        }

        // Save to DB
        const currentContext = this.deriveContext();
        const scenarioId = this.getOrCreateScenarioId(activePos, currentContext);

        this.db.exec("BEGIN TRANSACTION");
        
        // Clear existing strategy for this scenario first to ensure clean state?
        // Yes, because "missing" means "out/black".
        this.db.run("DELETE FROM strategies WHERE scenario_id = ?", [scenarioId]);

        const stmt = this.db.prepare("INSERT INTO strategies (scenario_id, hand, frequencies) VALUES (?, ?, ?)");
        
        for (const [hand, freqs] of Object.entries(newStrategy)) {
            stmt.run([scenarioId, hand, JSON.stringify(freqs)]);
        }
        stmt.free();
        this.db.exec("COMMIT");

        this.debouncedSave();
        this.updateView();
        
        // Feedback
        const btn = document.getElementById('import-prev-btn');
        if(btn) {
            const original = btn.textContent;
            btn.textContent = '✅';
            setTimeout(() => btn.textContent = original, 1000);
        }
    }

    // --- Rendering ---
    renderTreeControls() {
        const container = document.getElementById('tree-controls');
        if (!container) return;

        // Check for any raises to determine if BB should be hidden
        const hasRaise = this.steps.some(s => s.action && (s.action.includes('Raise') || s.action.includes('Allin')));
        
        container.innerHTML = this.steps.map((step, index) => {
            const { pos, action } = step;
            
            // Hide BB if it's the BB step (index 6 in standard config) and no action before it
            // Only strictly for the "First Pass" BB.
            if (pos === 'BB' && index === 6 && !hasRaise) return '';

            const isActive = index === this.currentStepIndex;
            const stack = this.stacks[pos];
            
            // Determine Raise Sizing options based on history
            let raiseLabel = 'Raise 2.5';
            let raiseValue = 'Raise 2.5';
            
            // Look at steps BEFORE this one to find last aggressor
            const history = this.steps.slice(0, index).filter(s => s.action && s.action !== 'Fold');
            const lastAggressor = history.reverse().find(a => a.action && (a.action.includes('Raise') || a.action.includes('Allin')));
            
            if (lastAggressor) {
                if (lastAggressor.action.includes('2.5') || lastAggressor.action.includes('2')) {
                    raiseLabel = 'Raise 9'; 
                    raiseValue = 'Raise 9';
                } else if (lastAggressor.action.includes('9') || lastAggressor.action.includes('6.5')) {
                    raiseLabel = 'Raise 22'; 
                    raiseValue = 'Raise 22';
                } else if (lastAggressor.action.includes('22') || lastAggressor.action.includes('14')) {
                    raiseLabel = 'Raise 45'; 
                    raiseValue = 'Raise 45';
                }
            } else if (pos === 'SB') {
                raiseLabel = 'Raise 3';
                raiseValue = 'Raise 3';
            }

            let content = '';
            
            if (isActive) {
                // Active Step
                content = `
                    <div class="space-y-1 relative z-10">
                        <button class="w-full text-left text-xs py-1 px-2 hover:bg-gray-700 bg-gray-900/50 rounded text-gray-400 border border-transparent hover:border-gray-500 transition-colors" onclick="treeManager.handleAction(${index}, '${pos}', 'Fold')">Fold</button>
                        <button class="w-full text-left text-xs py-1 px-2 hover:bg-gray-700 bg-gray-900/50 rounded text-green-400 font-bold border border-transparent hover:border-green-500 transition-colors" onclick="treeManager.handleAction(${index}, '${pos}', 'Call')">Call</button>
                        <button class="w-full text-left text-xs py-1 px-2 hover:bg-gray-700 bg-gray-900/50 rounded text-red-400 font-bold border border-transparent hover:border-red-500 transition-colors" onclick="treeManager.handleAction(${index}, '${pos}', '${raiseValue}')">${raiseLabel}</button>
                        <button class="w-full text-left text-xs py-1 px-2 hover:bg-gray-700 bg-gray-900/50 rounded text-red-600 font-bold border border-transparent hover:border-red-700 transition-colors" onclick="treeManager.handleAction(${index}, '${pos}', 'Allin 100')">Allin</button>
                    </div>
                `;
            } else if (action) {
                // Completed Step
                let colorClass = 'text-gray-400'; 
                if (action.includes('Raise')) colorClass = 'text-red-400';
                if (action.includes('Call')) colorClass = 'text-green-400';
                if (action.includes('Allin')) colorClass = 'text-red-600';
                
                content = `<div class="text-sm font-bold ${colorClass} mt-2">${action}</div>`;
            } else {
                content = `<div class="text-xs text-gray-600 mt-2">Waiting...</div>`;
            }

            return `
                <div class="flex-1 min-w-[80px] bg-gray-800 border ${isActive ? 'border-primary ring-1 ring-primary' : 'border-gray-700'} rounded p-2 flex flex-col gap-1 ${isActive ? '' : 'cursor-pointer'}" onclick="${isActive ? '' : `treeManager.resetTo(${index})`}">
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

        const activeStep = this.steps[this.currentStepIndex];
        const activePos = activeStep ? activeStep.pos : null;
        const strategy = this.getStrategyForCurrentState();
        
        // Determine if this is a subset range (player has acted previously)
        const rawHistory = this.steps.slice(0, this.currentStepIndex);
        const hasActedPreviously = rawHistory.some(s => s.pos === activePos && s.action && s.action !== 'None');

        this.renderer.renderGrid('gto-grid-container', strategy, (hand) => {
            if (this.editMode) {
                this.updateHandStrategy(hand);
            } else {
                this.selectHand(hand, strategy);
            }
        }, hasActedPreviously);

        const titleEl = document.getElementById('current-scenario-title');
        if (titleEl && activePos) {
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
             const activeStep = this.steps[this.currentStepIndex];
             const context = {
                scenarioName: this.getActionHistory().map(a => a.pos).join('_') + `_to_${activeStep.pos}`,
                heroPos: activeStep.pos,
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
    if (document.getElementById('tree-controls') || document.getElementById('gto-grid-container')) {
        const renderer = new GTORenderer();
        const llm = new LLMService();
        
        treeManager = new GTOTreeManager(renderer, llm);
        window.treeManager = treeManager;
        treeManager.init();
        
        const editBtn = document.getElementById('edit-mode-btn');
        if (editBtn) editBtn.addEventListener('click', () => treeManager.toggleEditMode());
        
        const saveBtn = document.getElementById('save-db-btn');
        if (saveBtn) saveBtn.addEventListener('click', () => treeManager.saveDatabase());

        const copyBtn = document.getElementById('copy-range-btn');
        if (copyBtn) copyBtn.addEventListener('click', () => treeManager.copyCurrentRange());
        
        const pasteBtn = document.getElementById('paste-range-btn');
        if (pasteBtn) pasteBtn.addEventListener('click', () => treeManager.pasteRange());

        const importBtn = document.getElementById('import-prev-btn');
        if (importBtn) importBtn.addEventListener('click', () => treeManager.importPreviousRange());

        const tools = document.querySelectorAll('.palette-tool');
        tools.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tool = e.target.dataset.tool;
                treeManager.setTool(tool);
            });
        });
    }
});
