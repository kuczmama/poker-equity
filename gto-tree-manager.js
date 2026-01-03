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
        this.spotPreflopActionsByFile = null; // Map<string,string>
        this.openRaiseByOpener = null; // Map<string,string> where opener is our 7-max seat label
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
        
        // Load Database + GTOW spot index (for action sizing) in parallel
        await Promise.all([
            this.loadDatabase(),
            this.loadSpotIndex()
        ]);
        this.updateView(); // Refresh with DB + spot sizing data
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

    async loadSpotIndex() {
        // This file is a compact index of the GTOWizard preflop graph we generated (action codes like R2.5, R7.5, RAI).
        // We use it to mirror the exact bet sizing flow, instead of guessing from pot_type or numeric heuristics.
        const res = await fetch('data/import_ranges/gtowizard_spots.7max.preflop.headsup.json');
        if (!res.ok) {
            throw new Error(`Failed to load GTOW spot index: ${res.status} ${res.statusText}`);
        }
        const data = await res.json();
        if (!data || !Array.isArray(data.spots)) {
            throw new Error("Invalid GTOW spot index format: missing 'spots' array.");
        }

        this.spotPreflopActionsByFile = new Map();
        this.openRaiseByOpener = new Map();

        for (const spot of data.spots) {
            const outputFile = spot?.output_file;
            const pre = spot?.params?.preflop_actions ?? '';
            if (typeof outputFile !== 'string') continue;
            this.spotPreflopActionsByFile.set(outputFile, String(pre));

            // Precompute open sizes from "*_vs_<OPENER>_OPEN.json" nodes.
            // Example: "LJ_vs_UTG_OPEN.json" has preflop_actions "...-R2.5" where 2.5 is the open size.
            const m = outputFile.match(/^[A-Z0-9\+_]+_vs_([A-Z0-9\+_]+)_OPEN\.json$/);
            if (m) {
                const opener = m[1];
                const raiseStr = this.raiseStringFromPreflopActions(String(pre));
                if (raiseStr) {
                    // Only set once; if multiple exist, they should agree for a given opener.
                    if (!this.openRaiseByOpener.has(opener)) this.openRaiseByOpener.set(opener, raiseStr);
                }
            }
        }
    }

    raiseStringFromPreflopActions(preflopActions) {
        // preflopActions is like "F-F-R2.5-R7.5-R15-R26-RAI"
        const parts = String(preflopActions || '').split('-').map(s => s.trim()).filter(Boolean);
        if (parts.length === 0) return null;
        
        // HU nodes often end with forced folds (e.g. "...-R7.5-F-F-F-F-F"),
        // so we want the last NON-fold action as the raise sizing token.
        let token = null;
        for (let i = parts.length - 1; i >= 0; i--) {
            const p = parts[i];
            if (p !== 'F') {
                token = p;
                break;
            }
        }
        if (!token) return null;

        if (token === 'RAI') return `Allin ${this.config.stackDepth}`;
        if (token.startsWith('R')) {
            const raw = token.slice(1);
            const n = parseFloat(raw);
            if (Number.isFinite(n)) {
                const s = Number.isInteger(n) ? String(Math.trunc(n)) : String(n);
                return `Raise ${s}`;
            }
            return `Raise ${raw}`;
        }
        return null;
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
    mapPositionToDB(pos) {
        // Map Frontend 7-max positions to GTO Wizard DB positions
        // Frontend: UTG, LJ, HJ, CO, BTN, SB, BB
        // DB (Imported): UTG+2, LJ, HJ, CO, BTN, SB, BB
        if (pos === 'UTG') return 'UTG+2';
        return pos;
    }

    mapVillainPositionToDB(pos) {
        // IMPORTANT: In the imported DB, "UTG" is frequently used as the opener label in villain_pos
        // for "*_vs_UTG_OPEN" and similar scenarios, even though the RFI node may be stored as UTG+2.
        // If we map villain "UTG" -> "UTG+2" we break the graph edge discovery for open sizes.
        if (pos === 'UTG') return 'UTG';
        return pos;
    }

    getHeroPosCandidates(pos) {
        // The imported GTOW dataset is inconsistent about whether "our UTG" is stored as UTG+2 or UTG.
        // We treat them as aliases and try both (in priority order) when locating a scenario node.
        if (pos === 'UTG') return ['UTG+2', 'UTG'];
        return [pos];
    }

    getVillainPosCandidates(pos) {
        // Same aliasing for villain positions. Some nodes label the opener as UTG even if the RFI node is UTG+2.
        if (pos === 'UTG') return ['UTG', 'UTG+2'];
        return [pos];
    }

    getStrategyForCurrentState() {
        if (!this.db) return {}; 
        
        // Use current step's position
        const activeStep = this.steps[this.currentStepIndex];
        if (!activeStep) return {};
        
        const activePos = activeStep.pos;
        const context = this.deriveContext();
        
        return this.getStrategyForContext(activePos, context.villainPos, context.prevAction, context.isRFI);
    }

    async getVillainStats(name) {
        try {
            const res = await fetch(`/villain?name=${encodeURIComponent(name)}`);
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            console.error("Failed to fetch villain stats:", e);
            return null;
        }
    }

    /**
     * Fuzzy search for the closest GTO strategy based on action amount.
     */
    findClosestStrategy(heroPos, villainPos, actionAmountBB) {
        if (!this.db) return {};

        let bestScenarioId = null;
        let minDiff = Infinity;
        let bestMatchAction = "";

        const heroCandidates = this.getHeroPosCandidates(heroPos);
        const villainCandidates = this.getVillainPosCandidates(villainPos);

        const query = "SELECT id, prev_action FROM scenarios WHERE hero_pos = :hero AND villain_pos = :villain";

        for (const dbHero of heroCandidates) {
            for (const dbVillain of villainCandidates) {
                const stmt = this.db.prepare(query);
                stmt.bind({ ':hero': dbHero, ':villain': dbVillain });
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
            }
        }

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

    getVillainRFIRange(villainPos) {
        if (!this.db) return null;
        const dbVillain = this.mapPositionToDB(villainPos);
        const query = "SELECT id FROM scenarios WHERE hero_pos = :hero AND prev_action = 'Fold'";
        const stmt = this.db.prepare(query);
        stmt.bind({ ':hero': dbVillain });
        
        let id = null;
        if (stmt.step()) id = stmt.getAsObject().id;
        stmt.free();
        
        if (!id) return null;
        
        const strategy = this.getStrategyByScenarioId(id);
        return Object.keys(strategy).filter(hand => {
             const freqs = strategy[hand];
             if (!freqs) return false;
             return ((freqs.raise || 0) + (freqs.raise_all_in || 0) + (freqs.call || 0)) > 0.01;
        }).join(',');
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

        const heroCandidates = this.getHeroPosCandidates(heroPos);
        const villainCandidates = isRFI ? ['Blinds'] : this.getVillainPosCandidates(villainPos);

        let scenarioId = null;
        if (isRFI) {
            const query = "SELECT id FROM scenarios WHERE hero_pos = :hero AND villain_pos = 'Blinds' AND prev_action = 'Fold'";
            for (const dbHero of heroCandidates) {
                const stmt = this.db.prepare(query);
                stmt.bind({ ':hero': dbHero });
                if (stmt.step()) {
                    scenarioId = stmt.getAsObject().id;
                    stmt.free();
                    break;
                }
                stmt.free();
            }
        } else {
            const query = "SELECT id FROM scenarios WHERE hero_pos = :hero AND villain_pos = :villain AND prev_action = :prev";
            for (const dbHero of heroCandidates) {
                for (const dbVillain of villainCandidates) {
                    const stmt = this.db.prepare(query);
                    stmt.bind({ ':hero': dbHero, ':villain': dbVillain, ':prev': prevAction });
                    if (stmt.step()) {
                        scenarioId = stmt.getAsObject().id;
                        stmt.free();
                        break;
                    }
                    stmt.free();
                }
                if (scenarioId) break;
            }
        }

        if (scenarioId) return this.getStrategyByScenarioId(scenarioId);

        // Fallback: fuzzy match raise sizes (e.g. UI "Raise 9" -> DB "Raise 7.5")
        const amt = this.parseActionAmount(prevAction);
        if (!isRFI && amt !== null) {
            return this.findClosestStrategy(heroPos, villainPos, amt);
        }

        return {};
    }

    parseActionAmount(actionStr) {
        if (!actionStr) return null;
        const match = String(actionStr).match(/(?:Raise|Allin)\s+([\d\.]+)/i);
        if (!match) return null;
        const n = parseFloat(match[1]);
        return Number.isFinite(n) ? n : null;
    }

    hasAnyActionInStrategy(strategy, actionKey, minFreq = 0.01) {
        if (!strategy) return false;
        for (const freqs of Object.values(strategy)) {
            if (!freqs) continue;
            if ((freqs[actionKey] || 0) > minFreq) return true;
        }
        return false;
    }

    /**
     * Return candidate "Raise X" actions available in DB for (hero_pos, villain_pos).
     */
    getRaiseActionsFromDB(heroPos, villainPos, potType) {
        if (!this.db) return [];
        
        let query = `
            SELECT prev_action
            FROM scenarios
            WHERE hero_pos = :hero
              AND villain_pos = :villain
              AND (prev_action LIKE 'Raise %' OR prev_action LIKE 'Allin %')
        `;
        const heroCandidates = this.getHeroPosCandidates(heroPos);
        const villainCandidates = this.getVillainPosCandidates(villainPos);
        
        if (potType) {
            query += ` AND pot_type = :potType`;
        }

        const actions = [];
        for (const dbHero of heroCandidates) {
            for (const dbVillain of villainCandidates) {
                const params = { ':hero': dbHero, ':villain': dbVillain };
                if (potType) params[':potType'] = potType;
                const stmt = this.db.prepare(query);
                stmt.bind(params);
                while (stmt.step()) {
                    const row = stmt.getAsObject();
                    if (row.prev_action) actions.push(String(row.prev_action));
                }
                stmt.free();
            }
        }

        // Deduplicate
        return Array.from(new Set(actions));
    }

    getNextPosInOrbit(pos) {
        const i = this.positions.indexOf(pos);
        if (i === -1) return null;
        if (i + 1 >= this.positions.length) return null;
        return this.positions[i + 1];
    }

    /**
     * Pick the next raise amount for the current raiser, by looking at what the NEXT actor
     * has in the DB when facing this raiser.
     *
     * Example:
     * - Current player = LJ wants to 3bet vs UTG open.
     * - Next actor will be UTG.
     * - So we query scenarios where hero_pos=UTG and villain_pos=LJ and pick a Raise size.
     */
    pickNextRaiseAction(nextActorPos, currentRaiserPos, minAmountBB) {
        const actions = this.getRaiseActionsFromDB(nextActorPos, currentRaiserPos);
        const parsed = actions
            .map(a => ({ action: a, amt: this.parseActionAmount(a) }))
            .filter(x => x.amt !== null);

        if (parsed.length === 0) return null;

        // Prefer the smallest raise strictly larger than the last raise amount
        const larger = parsed
            .filter(x => x.amt > (minAmountBB ?? 0))
            .sort((a, b) => a.amt - b.amt);
        if (larger.length > 0) return larger[0].action;

        // Otherwise fall back to closest overall
        parsed.sort((a, b) => Math.abs(a.amt - minAmountBB) - Math.abs(b.amt - minAmountBB));
        return parsed[0].action;
    }

    getRaiseOptionsForActiveStep(stepIndex, pos, lastAggressor) {
        // Mirror the imported GTOWizard bet-sizing flow using the spot index (data/import_ranges/gtowizard_spots.7max.preflop.json).
        // This avoids accidentally mixing open sizes + 3bet sizes + 4bet sizes in the same menu.
        //
        // At each decision node, GTOW effectively offers one canonical non-allin raise size.
        // We derive that size from the "next" spot file in the chain:
        // - No raises yet: opener size comes from "*_vs_<OPENER>_OPEN.json"
        // - Facing open (1 raise): 3bet size comes from "<OPENER>_vs_<HERO>_3BET.json"
        // - Facing 3bet (2 raises): 4bet size comes from "<3BETTOR>_vs_<HERO>_4BET.json"
        // - etc.

        const history = this.getActionHistory(stepIndex);
        const raises = history.filter(s => s.action.includes('Raise') || s.action.includes('Allin'));
        const raiseCount = raises.length;

        // RFI node: open size for this seat
        if (raiseCount === 0) {
            const raiseStr = this.openRaiseByOpener?.get(pos);
            return raiseStr ? [raiseStr] : [];
        }

        if (!lastAggressor || !this.spotPreflopActionsByFile) return [];

        // Determine which bet stage we are at:
        // 1 raise -> 3BET, 2 raises -> 4BET, 3 raises -> 5BET, 4 raises -> 6BET
        const stageNum = raiseCount + 2;
        const stage = `${stageNum}BET`;
        const keyFile = `${lastAggressor.pos}_vs_${pos}_${stage}.json`;
        const pre = this.spotPreflopActionsByFile.get(keyFile);
        if (!pre) return [];

        const raiseStr = this.raiseStringFromPreflopActions(pre);
        if (!raiseStr) return [];

        // Enforce monotonic sizing when applicable
        const minAmt = this.parseActionAmount(lastAggressor.action) ?? 0;
        const amt = this.parseActionAmount(raiseStr);
        if (amt !== null && amt <= (minAmt + 0.001)) return [];

        return [raiseStr];
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
        const dbHero = this.mapPositionToDB(hero);
        const dbVillain = this.mapPositionToDB(ctx.villainPos);

        let query, params;
        
        if (ctx.isRFI) {
            query = "SELECT id FROM scenarios WHERE hero_pos = ? AND villain_pos = 'Blinds' AND prev_action = 'Fold'";
            params = [dbHero];
        } else {
            query = "SELECT id FROM scenarios WHERE hero_pos = ? AND villain_pos = ? AND prev_action = ?";
            params = [dbHero, dbVillain, ctx.prevAction];
        }
        
        const res = this.db.exec(query, params);
        if (res.length > 0 && res[0].values.length > 0) {
             return res[0].values[0][0];
        }
        
        const name = `${dbHero} vs ${dbVillain || 'Blinds'} (${ctx.prevAction})`;
        this.db.run("INSERT INTO scenarios (name, hero_pos, villain_pos, prev_action, pot_type) VALUES (?, ?, ?, ?, ?)",
                    [name, dbHero, dbVillain || 'Blinds', ctx.prevAction, 'SRP']);
        
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

        const isRaise = action.includes('Raise') || action.includes('Allin');
        const isCall = action.includes('Call');

        // Ensure we always show a full 7-max orbit (coinpoker display), even though the underlying data is heads-up.
        while (this.steps.length < this.positions.length) {
            const nextPos = this.positions[this.steps.length];
            this.steps.push({ pos: nextPos, action: null });
        }

        // Force any "skipped" earlier positions to fold (so we don't visually compress the line).
        // Example: UTG folds, user jumps to HJ and raises -> LJ is auto-marked Fold.
        for (let i = 0; i < stepIndex; i++) {
            if (!this.steps[i].action) {
                this.steps[i] = { pos: this.steps[i].pos, action: 'Fold' };
            }
        }

        // Determine how many raises have occurred so far (heads-up spot graph assumption).
        // Your imported GTOWizard preflop set is heads-up per pairing, so once a second raise occurs
        // (3-bet or higher), action should immediately bounce back to the previous aggressor and we
        // should NOT continue the orbit to later seats (no multiway modeling).
        const activeSteps = this.steps.filter(s => s.action && s.action !== 'Fold');
        const raisers = activeSteps.filter(s => s.action.includes('Raise') || s.action.includes('Allin'));

        // If someone takes a non-fold action facing a raise (call or raise), we are now in a heads-up branch.
        // Force all later unopened seats in the first orbit to fold so the visual line stays 7-max but deterministic.
        if ((isCall || isRaise) && raisers.length >= 1) {
            for (let i = stepIndex + 1; i < this.positions.length; i++) {
                if (!this.steps[i].action) {
                    this.steps[i] = { pos: this.steps[i].pos, action: 'Fold' };
                }
            }
        }

        // Terminal handling: if there has been a raise and someone calls, we stop (no multiway / no further preflop nodes).
        if (isCall && raisers.length >= 1) {
            this.currentStepIndex = this.steps.length; // no active decision
            this.updateView();
            return;
        }

        // Ping-pong handling: on 3-bet+ (2nd raise), bounce back to previous aggressor as the next decision.
        if (isRaise && raisers.length >= 2) {
            const previousAggressor = raisers[raisers.length - 2];
            this.steps.push({ pos: previousAggressor.pos, action: null });
            this.currentStepIndex = this.steps.length - 1;
            this.updateView();
            return;
        }

        // Otherwise, continue the normal orbit (folds and the first open raise).
        this.currentStepIndex = stepIndex + 1;
        
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

    async handleImageImport(e) {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const strategy = await this.processRangeImage(file);
            
            // Save to DB
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
            
            alert("Range imported successfully! Don't forget to Save Database (💾) if you want to keep changes.");

        } catch (err) {
            console.error("Image Import Failed", err);
            alert("Import failed: " + err.message);
        }
        
        // Clear input so same file can be selected again
        e.target.value = '';
    }

    processRangeImage(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                
                const strategy = {};
                const ranks = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
                
                // --- Auto-Crop Heuristic ---
                // 1. Assume the Grid is a perfect Square (13x13).
                // 2. Assume the Grid spans the full WIDTH of the image.
                // 3. Assume any extra Height is the toolbar at the TOP.
                
                let gridSide = img.width;
                let startX = 0;
                let startY = 0;

                // If image is taller than it is wide (Portrait/Toolbar on top)
                if (img.height > img.width) {
                    // The grid is at the bottom. The header takes up the difference.
                    startY = img.height - img.width;
                }
                
                const cellW = gridSide / 13;
                const cellH = gridSide / 13;
                
                for(let r=0; r<13; r++) {
                    for(let c=0; c<13; c++) {
                        // Sample the center of each cell (safest point)
                        const cx = startX + (c * cellW) + (cellW / 2);
                        const cy = startY + (r * cellH) + (cellH / 2);
                        
                        // Bounds check
                        if (cx < 0 || cx >= img.width || cy < 0 || cy >= img.height) continue;

                        const p = ctx.getImageData(cx, cy, 1, 1).data; 
                        const red = p[0], green = p[1], blue = p[2];
                        const total = red + green + blue;

                        let freqs = { fold: 1.0 }; // Default to fold

                        // Skip dark colors (borders/text)
                        if (total > 30) {
                            const rP = red / total;
                            const gP = green / total;
                            const bP = blue / total;
                            
                            // Dominant Color Logic
                            if (rP > 0.50) freqs = { raise: 1.0 };       // Red -> Raise
                            else if (gP > 0.50) freqs = { call: 1.0 };  // Green -> Call
                            else if (bP > 0.50) freqs = { fold: 1.0 };  // Blue -> Fold
                            else {
                                // Mixed Strategy (blended colors)
                                freqs = { raise: rP, call: gP, fold: bP };
                            }
                        }
                        
                        // Map coordinates to Hand (e.g., 0,0 -> AA)
                        const r1 = ranks[r];
                        const r2 = ranks[c];
                        let hand;
                        if (r === c) hand = r1 + r2;       // Pair
                        else if (r < c) hand = r1 + r2 + 's'; // Suited
                        else hand = r2 + r1 + 'o';        // Offsuit
                        
                        strategy[hand] = freqs;
                    }
                }
                resolve(strategy);
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
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
            
            // Look at steps BEFORE this one to find last aggressor
            const history = this.steps.slice(0, index).filter(s => s.action && s.action !== 'Fold');
            const lastAggressor = history.reverse().find(a => a.action && (a.action.includes('Raise') || a.action.includes('Allin')));

            let content = '';
            
            if (isActive) {
                // Active Step
                const strategy = this.getStrategyForCurrentState();
                const canCall = this.hasAnyActionInStrategy(strategy, 'call', 0.01);
                let canRaise = this.hasAnyActionInStrategy(strategy, 'raise', 0.01);
                const canAllin = this.hasAnyActionInStrategy(strategy, 'raise_all_in', 0.01);

                // Determine raise options from DB "graph"
                const raiseOptions = this.getRaiseOptionsForActiveStep(index, pos, lastAggressor);
                
                // STRICT MODE: Only allow raises that exist in the DB as next-state scenarios
                // The user requested: "if we don't have a solution in the database, we shouldn't give that as an action"
                if (raiseOptions.length === 0) {
                    canRaise = false; 
                }

                // Check if any raise option is basically all-in
                // If yes, we don't need a separate generic All-in button if it duplicates a specific Raise
                const isRaiseAllin = raiseOptions.some(opt => {
                     const amt = this.parseActionAmount(opt);
                     return amt !== null && amt >= (this.config.stackDepth - 0.001);
                });

                // Build action buttons dynamically
                const raiseButtons = canRaise
                    ? raiseOptions.map(opt =>
                        `<button class="w-full text-left text-xs py-1 px-2 hover:bg-gray-700 bg-gray-900/50 rounded text-red-400 font-bold border border-transparent hover:border-red-500 transition-colors" onclick="treeManager.handleAction(${index}, '${pos}', '${opt}')">${opt}</button>`
                      ).join('')
                    : '';

                content = `
                    <div class="space-y-1 relative z-10">
                        <button class="w-full text-left text-xs py-1 px-2 hover:bg-gray-700 bg-gray-900/50 rounded text-gray-400 border border-transparent hover:border-gray-500 transition-colors" onclick="treeManager.handleAction(${index}, '${pos}', 'Fold')">Fold</button>
                        ${canCall ? `<button class="w-full text-left text-xs py-1 px-2 hover:bg-gray-700 bg-gray-900/50 rounded text-green-400 font-bold border border-transparent hover:border-green-500 transition-colors" onclick="treeManager.handleAction(${index}, '${pos}', 'Call')">Call</button>` : ''}
                        ${raiseButtons}
                        ${(canAllin && !isRaiseAllin) ? `<button class="w-full text-left text-xs py-1 px-2 hover:bg-gray-700 bg-gray-900/50 rounded text-red-600 font-bold border border-transparent hover:border-red-700 transition-colors" onclick="treeManager.handleAction(${index}, '${pos}', 'Allin ${this.config.stackDepth}')">Allin</button>` : ''}
                    </div>
                `;
            } else if (action) {
                // Completed Step
                let colorClass = 'text-gray-400'; 
                if (action.includes('Raise')) colorClass = 'text-red-400';
                if (action.includes('Call')) colorClass = 'text-green-400';
                const amt = this.parseActionAmount(action);
                if (amt !== null && amt >= (this.config.stackDepth - 0.001)) colorClass = 'text-red-600';
                
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

        const importImgBtn = document.getElementById('import-img-btn');
        const importImgInput = document.getElementById('import-img-input');
        if (importImgBtn && importImgInput) {
            importImgBtn.addEventListener('click', () => importImgInput.click());
            importImgInput.addEventListener('change', (e) => treeManager.handleImageImport(e));
        }

        const tools = document.querySelectorAll('.palette-tool');
        tools.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tool = e.target.dataset.tool;
                treeManager.setTool(tool);
            });
        });
    }
});
