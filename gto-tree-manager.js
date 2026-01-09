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

    renderTreeControls() {
        const container = document.getElementById('tree-controls');
        if (!container) return;
        
        let html = '';
        
        // Render each position as a button group
        this.steps.forEach((step, index) => {
            const isActive = index === this.currentStepIndex;
            const isPast = index < this.currentStepIndex;
            const isFuture = index > this.currentStepIndex;
            
            // Position button styling
            let posClass = 'px-3 py-2 rounded-t text-xs font-bold transition-all cursor-pointer ';
            if (isActive) {
                posClass += 'bg-primary text-black';
            } else if (isPast && step.action) {
                posClass += 'bg-gray-600 text-white hover:bg-gray-500';
            } else if (isFuture) {
                // Make future positions look clickable with hover effect
                posClass += 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white';
            } else {
                posClass += 'bg-gray-700 text-gray-400 hover:bg-gray-600';
            }
            
            html += `<div class="flex flex-col min-w-[80px]" data-step="${index}">`;
            html += `<button class="${posClass}" data-pos="${step.pos}" data-index="${index}">${step.pos}</button>`;
            
            // Action buttons for this position
            html += `<div class="flex flex-col bg-gray-900 rounded-b border border-gray-700 border-t-0">`;
            
            if (isActive || (isPast && !step.action)) {
                // Show available actions
                const context = this.deriveContext(index);
                const lastAggressor = this.getActionHistory(index).slice().reverse()
                    .find(a => a.action?.includes('Raise') || a.action?.includes('Allin'));
                
                // Check if facing an all-in (can only fold or call)
                const facingAllIn = lastAggressor && lastAggressor.action?.includes('Allin');
                
                // Fold button (always available)
                html += `<button class="action-btn px-2 py-1 text-xs hover:bg-gray-700 text-gray-300" data-action="Fold" data-index="${index}">Fold</button>`;
                
                // Call/Check button
                if (context.isRFI) {
                    // No call for RFI - you're opening, not calling
                } else {
                    html += `<button class="action-btn px-2 py-1 text-xs hover:bg-gray-700 text-green-400" data-action="Call" data-index="${index}">Call</button>`;
                }
                
                // Only show raise options if NOT facing an all-in
                if (!facingAllIn) {
                    const raiseOptions = this.getRaiseOptionsForActiveStep(index, step.pos, lastAggressor);
                    
                    if (raiseOptions.length > 0) {
                        raiseOptions.forEach(raiseOpt => {
                            html += `<button class="action-btn px-2 py-1 text-xs hover:bg-gray-700 text-red-400" data-action="${raiseOpt}" data-index="${index}">${raiseOpt}</button>`;
                        });
                    } else {
                        // Default raise option if none found
                        const defaultRaise = context.isRFI ? 'Raise 2.5' : 'Raise 7.5';
                        html += `<button class="action-btn px-2 py-1 text-xs hover:bg-gray-700 text-red-400" data-action="${defaultRaise}" data-index="${index}">${defaultRaise}</button>`;
                    }
                    
                    // All-in option (only if not already facing all-in)
                    html += `<button class="action-btn px-2 py-1 text-xs hover:bg-gray-700 text-red-600" data-action="Allin 100" data-index="${index}">All-In</button>`;
                }
            } else if (step.action) {
                // Show the action that was taken
                let actionClass = 'text-gray-400';
                if (step.action.includes('Raise') || step.action.includes('Allin')) actionClass = 'text-red-400';
                else if (step.action === 'Call') actionClass = 'text-green-400';
                else if (step.action === 'Fold') actionClass = 'text-gray-500';
                
                html += `<div class="px-2 py-1 text-xs ${actionClass}">${step.action}</div>`;
            }
            
            html += '</div></div>';
        });
        
        container.innerHTML = html;
        
        // Bind click events
        container.querySelectorAll('.action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                const index = parseInt(e.target.dataset.index);
                const pos = this.steps[index].pos;
                this.handleAction(index, pos, action);
            });
        });
        
        // Bind position click to jump to that step
        container.querySelectorAll('button[data-pos]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.index);

                if (index <= this.currentStepIndex) {
                    // Allow clicking on past/current positions to navigate back
                    this.currentStepIndex = index;
                    this.updateView();
                } else if (index > this.currentStepIndex) {
                    // QoL: Allow clicking future positions - auto-fold all intermediate players
                    for (let i = this.currentStepIndex; i < index; i++) {
                        if (!this.steps[i].action) {
                            this.steps[i] = { pos: this.steps[i].pos, action: 'Fold' };
                        }
                    }
                    // Jump to the clicked position
                    this.currentStepIndex = index;
                    this.updateView();
                }
            });
        });
    }

    updateView() {
        // Re-render tree controls
        this.renderTreeControls();
        
        // Get strategy for current state
        const strategy = this.getStrategyForCurrentState();

        // Determine if this is a subset range (facing action vs RFI)
        const context = this.deriveContext();
        const isSubsetRange = !context.isRFI;

        // Store context for external access (e.g., postflop solver)
        const activeStep = this.steps[this.currentStepIndex];
        if (activeStep) {
            this.context = {
                ...context,
                heroPos: activeStep.pos
            };
        }
        
        // Update the grid
        this.renderer.renderGrid('gto-grid-container', strategy, (hand) => {
            this.onHandClick(hand);
        }, isSubsetRange);

        // Update scenario title
        const titleEl = document.getElementById('current-scenario-title');

        // Handle case where activeStep doesn't exist (end of action sequence)
        if (!activeStep) {
            if (titleEl) {
                titleEl.textContent = 'Preflop Action Complete - Select Board to Continue';
            }
            const handInfo = document.getElementById('hand-info-content');
            if (handInfo) {
                handInfo.innerHTML = '<p class="text-gray-400">Betting round complete. Select flop cards to continue to postflop.</p>';
            }
            return; // Exit early
        }

        if (titleEl) {
            if (context.isRFI) {
                titleEl.textContent = `${activeStep.pos} RFI (Open Raise)`;
            } else {
                titleEl.textContent = `${activeStep.pos} vs ${context.villainPos} ${context.prevAction}`;
            }
        }

        // Update metadata display
        const metadata = this.getScenarioMetadata(activeStep.pos, context.villainPos, context.prevAction);
        const sourceEl = document.getElementById('data-source');
        const cfrInfoEl = document.getElementById('cfr-info');

        if (metadata && sourceEl && cfrInfoEl) {
            if (metadata.source === 'CFR') {
                sourceEl.textContent = 'Source: CFR Computed';
                sourceEl.className = 'text-green-400 font-semibold';

                const algoEl = document.getElementById('cfr-algorithm');
                const itersEl = document.getElementById('cfr-iterations');
                const expEl = document.getElementById('cfr-exploitability');

                if (algoEl) algoEl.textContent = metadata.algorithm.toUpperCase();
                if (itersEl) itersEl.textContent = metadata.iterations.toLocaleString();
                if (expEl) expEl.textContent = (metadata.exploitability * 100).toFixed(3);

                cfrInfoEl.classList.remove('hidden');
            } else if (metadata.source === 'GTOWizard') {
                sourceEl.textContent = 'Source: GTOWizard Import';
                sourceEl.className = 'text-blue-400';
                cfrInfoEl.classList.add('hidden');
            } else if (metadata.source === 'CFR (computing...)') {
                sourceEl.textContent = 'Source: CFR (No Metadata)';
                sourceEl.className = 'text-yellow-400';
                cfrInfoEl.classList.add('hidden');
            } else {
                sourceEl.textContent = 'Source: Not Found';
                sourceEl.className = 'text-gray-500';
                cfrInfoEl.classList.add('hidden');
            }
        }

        // Setup edit mode handlers if in edit mode
        if (this.editMode) {
            this.setupEditModeHandlers();
        }
    }

    onHandClick(hand) {
        if (this.editMode) {
            this.updateHandStrategy(hand);
            return;
        }
        
        // Show hand info
        const infoEl = document.getElementById('hand-info-content');
        if (!infoEl) return;
        
        const strategy = this.getStrategyForCurrentState();
        const handStrat = strategy[hand];
        
        if (!handStrat) {
            infoEl.innerHTML = `<p class="text-gray-400">${hand}: Not in range (Fold 100%)</p>`;
            return;
        }
        
        let html = `<h3 class="text-lg font-bold text-white mb-2">${hand}</h3>`;
        html += '<div class="space-y-1">';
        
        // Get color class for any action (including granular raises)
        const getColorClass = (action) => {
            if (action === 'fold') return 'text-blue-400';
            if (action === 'call') return 'text-green-400';
            if (action === 'raise_all_in' || action === 'all_in') return 'text-red-600';
            if (action.startsWith('raise')) return 'text-red-400';
            return 'text-gray-300';
        };
        
        // Format action name for display
        const formatAction = (action) => {
            if (action.startsWith('raise_')) {
                const size = action.replace('raise_', '');
                if (size === 'all_in') return 'All-In';
                return `Raise ${size}`;
            }
            return action.charAt(0).toUpperCase() + action.slice(1);
        };
        
        // Sort actions: fold, call, raises (by size), all-in
        const sortedActions = Object.entries(handStrat).sort((a, b) => {
            const order = { 'fold': 0, 'call': 1, 'raise_all_in': 100, 'all_in': 100 };
            const getOrder = (action) => {
                if (order[action] !== undefined) return order[action];
                if (action.startsWith('raise_')) {
                    const size = parseFloat(action.replace('raise_', ''));
                    return isNaN(size) ? 50 : 10 + size;
                }
                return 50;
            };
            return getOrder(a[0]) - getOrder(b[0]);
        });
        
        for (const [action, freq] of sortedActions) {
            const pct = (freq * 100).toFixed(1);
            const colorClass = getColorClass(action);
            const displayName = formatAction(action);
            html += `<div class="flex justify-between"><span class="${colorClass}">${displayName}</span><span>${pct}%</span></div>`;
        }
        
        html += '</div>';
        infoEl.innerHTML = html;
    }

    setupEditModeHandlers() {
        // Setup painting handlers for edit mode
        const container = document.getElementById('gto-grid-container');
        if (!container) return;
        
        container.querySelectorAll('.gto-cell').forEach(cell => {
            cell.addEventListener('mousedown', () => {
                this.isPainting = true;
                const hand = cell.dataset.hand;
                if (hand) this.updateHandStrategy(hand);
            });
            
            cell.addEventListener('mouseenter', () => {
                if (this.isPainting) {
                    const hand = cell.dataset.hand;
                    if (hand) this.updateHandStrategy(hand);
                }
            });
        });
        
        document.addEventListener('mouseup', () => {
            this.isPainting = false;
        });
        
        // Setup palette tool selection
        document.querySelectorAll('.palette-tool').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setTool(btn.dataset.tool);
            });
        });
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
            // Optional: Spot index might not exist if using pure custom DB
            console.log("GTOW spot index not found (optional for custom DB).");
            return;
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

    getScenarioMetadata(heroPos, villainPos, prevAction) {
        if (!this.db) return null;

        const heroCandidates = this.getHeroPosCandidates(heroPos);
        const villainCandidates = this.getVillainPosCandidates(villainPos);

        // Try to find scenario with CFR metadata
        for (const dbHero of heroCandidates) {
            for (const dbVillain of villainCandidates) {
                const stmt = this.db.prepare(`
                    SELECT sc.variant, cm.algorithm, cm.iterations, cm.exploitability
                    FROM scenarios sc
                    LEFT JOIN cfr_metadata cm ON sc.id = cm.scenario_id
                    WHERE sc.hero_pos = ? AND sc.villain_pos = ? AND sc.prev_action = ?
                    ORDER BY sc.variant DESC
                    LIMIT 1
                `);

                stmt.bind([dbHero, dbVillain, prevAction]);

                if (stmt.step()) {
                    const row = stmt.getAsObject();
                    stmt.free();

                    if ((row.variant === 'CFR' || row.variant === 'Computed') && row.algorithm) {
                        return {
                            source: 'CFR',
                            algorithm: row.algorithm,
                            iterations: row.iterations,
                            exploitability: row.exploitability
                        };
                    } else if (row.variant === 'Cash') {
                        return { source: 'GTOWizard' };
                    } else if (row.variant === 'CFR' || row.variant === 'Computed') {
                        // CFR/Computed scenario but no metadata yet
                        return { source: 'CFR (computing...)' };
                    }
                }
                stmt.free();
            }
        }

        return { source: 'Not Found' };
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

        // Try to find scenario, preferring CFR data (native 7-max) over Cash (GTO Wizard 9-max adapted)
        let scenarioId = null;
        const variants = ['Computed', 'CFR', 'Cash']; // Priority: Computed > CFR > GTO Wizard
        
        for (const variant of variants) {
            if (scenarioId) break;
            
            if (isRFI) {
                const query = "SELECT id FROM scenarios WHERE hero_pos = :hero AND villain_pos = 'Blinds' AND prev_action = 'Fold' AND (variant = :variant OR variant IS NULL)";
                for (const dbHero of heroCandidates) {
                    const stmt = this.db.prepare(query);
                    stmt.bind({ ':hero': dbHero, ':variant': variant });
                    if (stmt.step()) {
                        scenarioId = stmt.getAsObject().id;
                        stmt.free();
                        break;
                    }
                    stmt.free();
                }
            } else {
                const query = "SELECT id FROM scenarios WHERE hero_pos = :hero AND villain_pos = :villain AND prev_action = :prev AND (variant = :variant OR variant IS NULL)";
                for (const dbHero of heroCandidates) {
                    for (const dbVillain of villainCandidates) {
                        const stmt = this.db.prepare(query);
                        stmt.bind({ ':hero': dbHero, ':villain': dbVillain, ':prev': prevAction, ':variant': variant });
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
        // Determine betting context to filter appropriate raise sizes
        const history = this.getActionHistory(stepIndex);
        const raises = history.filter(s => s.action?.includes('Raise') || s.action?.includes('Allin'));
        const raiseCount = raises.length;
        
        // Define contextually appropriate size ranges (in BB)
        // These match the CFR PREFLOP_RAISE_SIZES categories
        let minSize = 0;
        let maxSize = 100;
        
        if (raiseCount === 0) {
            // RFI (open raise): 2-4bb
            minSize = 2;
            maxSize = 4;
        } else if (raiseCount === 1) {
            // 3-bet: 6-16bb
            minSize = 6;
            maxSize = 16;
        } else if (raiseCount === 2) {
            // 4-bet: 18-25bb
            minSize = 18;
            maxSize = 25;
        } else if (raiseCount === 3) {
            // 5-bet: 25-40bb
            minSize = 25;
            maxSize = 40;
        }
        // 6bet+ is usually all-in
        
        // First check custom DB for explicit raise options from this spot
        // This takes precedence over GTOWizard heuristics
        if (this.db) {
            // Query: Find all "Raise X" actions that appear as 'prev_action' 
            // in a scenario where villain_pos = ME.
            const myDbPos = this.mapPositionToDB(pos);
            
            const query = `
                SELECT DISTINCT prev_action 
                FROM scenarios 
                WHERE villain_pos = :me 
                  AND (prev_action LIKE 'Raise%' OR prev_action LIKE 'Allin%')
            `;
            
            const stmt = this.db.prepare(query);
            stmt.bind({ ':me': myDbPos });
            
            const opts = [];
            while(stmt.step()) {
                const row = stmt.getAsObject();
                const action = row.prev_action;
                const amount = this.parseActionAmount(action);
                
                // Filter by context-appropriate sizes
                if (amount !== null && amount >= minSize && amount <= maxSize) {
                    opts.push(action);
                } else if (action.includes('Allin') && raiseCount >= 3) {
                    // All-in is appropriate for 5bet+ spots
                    opts.push(action);
                }
            }
            stmt.free();
            
            // If we found specific options in our DB, return them!
            if (opts.length > 0) {
                // Sort by amount
                return opts.sort((a, b) => {
                    const vA = this.parseActionAmount(a) || 0;
                    const vB = this.parseActionAmount(b) || 0;
                    return vA - vB;
                });
            }
        }
        
        // Fallback to GTOWizard file heuristics if no custom DB options found
        // (history, raises, raiseCount already defined at top of function)

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

        // Ensure we always show a full 7-max orbit (coinpoker display)
        // We extend the orbit if necessary, but we don't necessarily want to force HU logic anymore.
        
        // Find current max step index to know where we are in the orbit
        // Standard full orbit is 7 steps.
        const fullOrbitLength = this.positions.length;
        
        // If we are still within the first orbit, we can just fill out the remaining positions
        if (this.steps.length < fullOrbitLength) {
             while (this.steps.length < fullOrbitLength) {
            const nextPos = this.positions[this.steps.length];
            this.steps.push({ pos: nextPos, action: null });
            }
        } else {
            // We are extending beyond the first orbit (e.g. 3-bet pot)
            // We need to determine who acts next.
            // Normally, next actor is next position in orbit who hasn't folded.
            // But for simple "ping pong" logic or just sequential logic:
            
            // If Raise/Call, we need to find the next player in the rotation.
            // Simplest logic: Check next index in positions array (wrapping around)
            // Check if that player has folded?
            // For now, let's just append the NEXT position in the standard sequence.
            
            // BUT: We need to respect the table order.
            // pos = 'UTG' -> next is 'LJ'.
            const nextPosName = this.getNextPosInOrbit(pos);
            // In a real game we skip folded players.
            // Here, we can look at previous steps for that position to see if they folded.
            // But steps is linear history.
            // We should find the next position in `this.positions` that does NOT have a 'Fold' in the history?
            // Actually, if they folded, they are out.
            
            // NOTE: Multi-way logic is complex. 
            // For "Call" to work in Ring Game:
            // UTG Raise -> LJ Call -> HJ Decision.
            // Current code pushed everyone else to Fold if there was a call.
            // I REMOVED that block. Now we just fall through to "continue normal orbit".
        }

        // Force any "skipped" earlier positions to fold (so we don't visually compress the line).
        // Example: UTG folds, user jumps to HJ and raises -> LJ is auto-marked Fold.
        for (let i = 0; i < stepIndex; i++) {
            if (!this.steps[i].action) {
                this.steps[i] = { pos: this.steps[i].pos, action: 'Fold' };
            }
        }

        // --- NEW RING GAME LOGIC ---
        // Instead of forcing HU, we just advance the cursor.
        // But if it's a 3-bet (Re-Raise), we typically want to jump back to the original raiser?
        // Or do we let the players in between act (Cold 4-bet)?
        // GTO charts usually assume HU after 3-bet?
        // Let's stick to:
        // 1. If Open Raise -> Next player acts. (Normal Orbit)
        // 2. If 3-Bet (Raise vs Raise) -> Jump back to Original Raiser (HU assumption usually, or just next active player).
        //
        // Let's keep the "Ping Pong" logic only if it's strictly HU?
        // "If isRaise and raisers.length >= 2" -> This implies 3-bet.
        
        const activeSteps = this.steps.filter(s => s.action && s.action !== 'Fold');
        const raisers = activeSteps.filter(s => s.action.includes('Raise') || s.action.includes('Allin'));

        if (isRaise && raisers.length >= 2) {
             // 3-Bet or 4-Bet scenario.
             // We jump back to the PREVIOUS aggressor.
            const previousAggressor = raisers[raisers.length - 2];
             
             // Check if we already added this step?
             // steps array is linear. We push a new step.
            this.steps.push({ pos: previousAggressor.pos, action: null });
            this.currentStepIndex = this.steps.length - 1;
        } else {
            // Normal sequential action (Open Raise, Calls, Folds)
            // Just move to next step in the array.
            // If we are at end of array, we might need to append next player?
            // "Orbit" logic handles filling the array up to 7 initially.
            // If we are at index 6 (BB) and BB calls/raises?
            // If BB Raises vs UTG Open -> Back to UTG (handled by Ping Pong above).
            // If BB Calls? Action closes. Hand ends.
            
            // Check for closing action?
            // If (Call) and (Raisers > 0) and (We are Big Blind or closing the betting)?
            // For charts, we usually stop at the call.
            
            // Check if we can advance to next step
            const nextIndex = stepIndex + 1;
            if (nextIndex < this.steps.length) {
                this.currentStepIndex = nextIndex;
            } else {
                // End of action sequence - keep currentStepIndex at last valid step
                // This will trigger the "Action Complete" message in updateView
                this.currentStepIndex = this.steps.length;
            }
        }

        this.updateView();
    }
}
