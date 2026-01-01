// WebGPU Poker Hand Evaluator
// Uses a Compute Shader to run millions of simulations in parallel

export class GpuEquityCalculator {
    constructor() {
        this.device = null;
        this.pipeline = null;
        this.bindGroup = null;
    }

    async init() {
        if (!navigator.gpu) {
            console.log("WebGPU not supported on this browser.");
            return false;
        }

        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            console.log("No appropriate GPUAdapter found.");
            return false;
        }

        this.device = await adapter.requestDevice();
        console.log(`GPU Initialized: ${adapter.name}`); // Should say Apple M1/M2 etc.
        return true;
    }

    // WGSL Shader Code
    // A simplified hand evaluator that fits in a shader
    getShaderCode() {
        return `
        struct SimulationResult {
            heroWins: atomic<u32>,
            villainWins: atomic<u32>,
            ties: atomic<u32>,
        }

        struct GameConfig {
            heroCard1: u32,
            heroCard2: u32,
            villainCard1: u32,
            villainCard2: u32,
            board1: u32,
            board2: u32,
            board3: u32,
            // 4 and 5 might be 255 (empty)
            board4: u32,
            board5: u32,
            seed: u32,
        }

        @group(0) @binding(0) var<storage, read_write> result: SimulationResult;
        @group(0) @binding(1) var<uniform> config: GameConfig;

        // PCG Random Number Generator
        fn rand(state: ptr<function, u32>) -> u32 {
            let old = *state;
            *state = old * 747796405u + 2891336453u;
            let word = ((*state >> ((old >> 28u) + 4u)) ^ old) * 277803737u;
            return (word >> 22u) ^ word;
        }

        // Card: 0..51. Rank = val >> 2, Suit = val & 3
        
        fn get_rank(card: u32) -> u32 { return card >> 2u; }
        fn get_suit(card: u32) -> u32 { return card & 3u; }

        fn eval_5_cards(c1: u32, c2: u32, c3: u32, c4: u32, c5: u32) -> u32 {
            var ranks = array<u32, 5>(get_rank(c1), get_rank(c2), get_rank(c3), get_rank(c4), get_rank(c5));
            var suits = array<u32, 5>(get_suit(c1), get_suit(c2), get_suit(c3), get_suit(c4), get_suit(c5));

            // Sort Ranks (Bubble sort is fine for 5 items)
            for (var i = 0u; i < 4u; i = i + 1u) {
                for (var j = 0u; j < 4u - i; j = j + 1u) {
                    if (ranks[j] < ranks[j+1u]) { // Descending
                        let tr = ranks[j]; ranks[j] = ranks[j+1u]; ranks[j+1u] = tr;
                        let ts = suits[j]; suits[j] = suits[j+1u]; suits[j+1u] = ts;
                    }
                }
            }

            // Check Flush
            let is_flush = (suits[0] == suits[1]) & (suits[1] == suits[2]) & (suits[2] == suits[3]) & (suits[3] == suits[4]);

            // Check Straight
            var is_straight = true;
            for (var i = 0u; i < 4u; i = i + 1u) {
                if (ranks[i] != ranks[i+1u] + 1u) {
                    // Check Wheel: A,5,4,3,2 -> 12,3,2,1,0
                    if (i == 0u && ranks[0] == 12u && ranks[1] == 3u && ranks[2] == 2u && ranks[3] == 1u && ranks[4] == 0u) {
                        // Wheel!
                    } else {
                        is_straight = false;
                    }
                }
            }

            // Counts
            var counts = array<u32, 13>(0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u,0u);
            for(var i=0u; i<5u; i=i+1u) {
                counts[ranks[i]] = counts[ranks[i]] + 1u;
            }

            var four = 255u;
            var three = 255u;
            var pair1 = 255u;
            var pair2 = 255u;

            for(var i=12u; i<13u; i=i-1u) { // Reverse check (u32 wrap around check needed if i becomes huge, but i>=0 loop with uint is tricky)
                // Using standard loop
            }
            // WGSL reverse loops are annoying with uint
            for(var k=0u; k<13u; k=k+1u) {
                let r = 12u - k;
                let c = counts[r];
                if (c == 4u) { four = r; }
                else if (c == 3u) { three = r; }
                else if (c == 2u) {
                    if (pair1 == 255u) { pair1 = r; }
                    else { pair2 = r; }
                }
            }

            // Construct Score: Type(4) | R1(4) | R2(4) | R3(4) | R4(4) | R5(4)
            // SF: 8, 4Kind: 7, Full: 6, Fl: 5, Str: 4, 3Kind: 3, 2Pr: 2, Pr: 1, HC: 0

            if (is_flush && is_straight) {
                var top = ranks[0];
                if (ranks[0] == 12u && ranks[1] == 3u) { top = 3u; } // Wheel top 5
                return (8u << 20u) | (top << 16u);
            }
            if (four != 255u) {
                // Find kicker
                var k = 0u;
                for(var i=0u; i<5u; i=i+1u) { if(ranks[i] != four) { k = ranks[i]; } }
                return (7u << 20u) | (four << 16u) | (k << 12u);
            }
            if (three != 255u && pair1 != 255u) {
                return (6u << 20u) | (three << 16u) | (pair1 << 12u);
            }
            if (is_flush) {
                 return (5u << 20u) | (ranks[0]<<16u) | (ranks[1]<<12u) | (ranks[2]<<8u) | (ranks[3]<<4u) | ranks[4];
            }
            if (is_straight) {
                var top = ranks[0];
                if (ranks[0] == 12u && ranks[1] == 3u) { top = 3u; }
                return (4u << 20u) | (top << 16u);
            }
            if (three != 255u) {
                 // Kickers
                 var k1 = 255u; var k2 = 255u;
                 for(var i=0u; i<5u; i=i+1u) {
                     if(ranks[i] != three) {
                         if(k1 == 255u) { k1 = ranks[i]; } else { k2 = ranks[i]; }
                     }
                 }
                 return (3u << 20u) | (three << 16u) | (k1 << 12u) | (k2 << 8u);
            }
            if (pair1 != 255u && pair2 != 255u) {
                var k = 0u;
                for(var i=0u; i<5u; i=i+1u) { if(ranks[i]!=pair1 && ranks[i]!=pair2) { k = ranks[i]; } }
                return (2u << 20u) | (pair1 << 16u) | (pair2 << 12u) | (k << 8u);
            }
            if (pair1 != 255u) {
                 var k1=255u; var k2=255u; var k3=255u;
                 for(var i=0u; i<5u; i=i+1u) {
                     if(ranks[i] != pair1) {
                         if(k1==255u){k1=ranks[i];} else if(k2==255u){k2=ranks[i];} else {k3=ranks[i];}
                     }
                 }
                 return (1u << 20u) | (pair1 << 16u) | (k1 << 12u) | (k2 << 8u) | (k3 << 4u);
            }
            
            return (ranks[0]<<16u) | (ranks[1]<<12u) | (ranks[2]<<8u) | (ranks[3]<<4u) | ranks[4];
        }

        fn eval_7_cards(c1: u32, c2: u32, c3: u32, c4: u32, c5: u32, c6: u32, c7: u32) -> u32 {
            // Brute force 7 choose 5 is 21 combos. 
            // In shader, arrays are fixed size. 
            // We'll just put them in array and loop combos.
            var pool = array<u32, 7>(c1, c2, c3, c4, c5, c6, c7);
            var best_score = 0u;

            // Hardcoded combos for speed/simplicity in shader
            // 01234, 01235, 01236 ... etc
            // Generating indices on the fly is messy in WGSL, let's just do a pattern or simplify.
            // Actually, we can just omit 2 cards.
            
            for (var i = 0u; i < 7u; i = i + 1u) {
                for (var j = i + 1u; j < 7u; j = j + 1u) {
                    // Omit i and j
                    var hand = array<u32, 5>(0u,0u,0u,0u,0u);
                    var count = 0u;
                    for (var k = 0u; k < 7u; k = k + 1u) {
                        if (k != i && k != j) {
                            hand[count] = pool[k];
                            count = count + 1u;
                        }
                    }
                    let score = eval_5_cards(hand[0], hand[1], hand[2], hand[3], hand[4]);
                    if (score > best_score) { best_score = score; }
                }
            }
            return best_score;
        }

        @compute @workgroup_size(64)
        fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
            var rng_state = config.seed + global_id.x;
            
            // Generate Random Turn/River if needed
            // Simple deck draw logic (rejection sampling)
            
            var board = array<u32, 5>(config.board1, config.board2, config.board3, config.board4, config.board5);
            var used = array<bool, 52>();
            
            // Mark used cards
            used[config.heroCard1] = true;
            used[config.heroCard2] = true;
            used[config.villainCard1] = true;
            used[config.villainCard2] = true;
            if (config.board1 != 255u) { used[config.board1] = true; }
            if (config.board2 != 255u) { used[config.board2] = true; }
            if (config.board3 != 255u) { used[config.board3] = true; }
            if (config.board4 != 255u) { used[config.board4] = true; }
            if (config.board5 != 255u) { used[config.board5] = true; }

            // Fill empty board slots
            for (var i = 0u; i < 5u; i = i + 1u) {
                if (board[i] == 255u) {
                    // Draw random card
                    loop {
                        let c = rand(&rng_state) % 52u;
                        if (!used[c]) {
                            board[i] = c;
                            used[c] = true;
                            break;
                        }
                    }
                }
            }

            // Eval
            let scoreHero = eval_7_cards(
                config.heroCard1, config.heroCard2,
                board[0], board[1], board[2], board[3], board[4]
            );
            let scoreVillain = eval_7_cards(
                config.villainCard1, config.villainCard2,
                board[0], board[1], board[2], board[3], board[4]
            );

            if (scoreHero > scoreVillain) {
                atomicAdd(&result.heroWins, 1u);
            } else if (scoreVillain > scoreHero) {
                atomicAdd(&result.villainWins, 1u);
            } else {
                atomicAdd(&result.ties, 1u);
            }
        }
        `;
    }

    async calculateEquity(heroCards, villainCards, boardCards, iterations = 1000000) {
        if (!this.device) {
             const success = await this.init();
             if (!success) throw new Error("WebGPU initialization failed");
        }

        // Convert cards to u32 (0-51)
        // Helper
        const parse = (c) => {
            if (!c) return 255;
            const ranks = {'2':0,'3':1,'4':2,'5':3,'6':4,'7':5,'8':6,'9':7,'T':8,'J':9,'Q':10,'K':11,'A':12};
            const suits = {'s':0,'h':1,'d':2,'c':3};
            return (ranks[c[0]] << 2) | suits[c[1]];
        };

        const configData = new Uint32Array([
            parse(heroCards[0]), parse(heroCards[1]),
            parse(villainCards[0]), parse(villainCards[1]),
            parse(boardCards[0]), parse(boardCards[1]), parse(boardCards[2]),
            parse(boardCards[3]), parse(boardCards[4]),
            Math.floor(Math.random() * 1000000) // Seed
        ]);

        // Create Buffers
        // Result Buffer (3 x u32)
        const resultBufferSize = 12; 
        const resultBuffer = this.device.createBuffer({
            size: resultBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });

        // Config Buffer
        const configBuffer = this.device.createBuffer({
            size: configData.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(configBuffer, 0, configData);

        // Pipeline
        const shaderModule = this.device.createShaderModule({ code: this.getShaderCode() });
        const computePipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: shaderModule, entryPoint: 'main' },
        });

        const bindGroup = this.device.createBindGroup({
            layout: computePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: resultBuffer } },
                { binding: 1, resource: { buffer: configBuffer } },
            ],
        });

        // Run
        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(computePipeline);
        passEncoder.setBindGroup(0, bindGroup);
        
        const workgroupSize = 64;
        const workgroups = Math.ceil(iterations / workgroupSize);
        passEncoder.dispatchWorkgroups(workgroups);
        passEncoder.end();

        // Read back
        const gpuReadBuffer = this.device.createBuffer({
            size: resultBufferSize,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        commandEncoder.copyBufferToBuffer(resultBuffer, 0, gpuReadBuffer, 0, resultBufferSize);

        this.device.queue.submit([commandEncoder.finish()]);

        await gpuReadBuffer.mapAsync(GPUMapMode.READ);
        const arrayBuffer = gpuReadBuffer.getMappedRange();
        const results = new Uint32Array(arrayBuffer);
        
        const heroWins = results[0];
        const villainWins = results[1];
        const ties = results[2];
        const total = heroWins + villainWins + ties;

        return {
            equity: heroWins / total,
            win: heroWins,
            lose: villainWins,
            tie: ties,
            total
        };
    }
}




