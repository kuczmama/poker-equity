/**
 * Preflop CFR+ Solver for Texas Hold'em
 *
 * Fast C++ implementation of Counterfactual Regret Minimization
 * specifically designed for preflop scenarios.
 *
 * Compile: g++ -O3 -march=native -std=c++17 -o preflop_cfr preflop_cfr.cpp -lpthread
 * Usage: ./preflop_cfr --scenario rfi --position UTG --iterations 10000
 */

#include <iostream>
#include <vector>
#include <array>
#include <unordered_map>
#include <string>
#include <cmath>
#include <algorithm>
#include <numeric>
#include <random>
#include <thread>
#include <mutex>
#include <chrono>
#include <fstream>
#include <sstream>
#include <iomanip>

// =============================================================================
// CONSTANTS AND HAND DEFINITIONS
// =============================================================================

constexpr int NUM_HANDS = 169;
constexpr int NUM_RANKS = 13;

const char RANKS[] = "AKQJT98765432";
const std::string POSITIONS[] = {"UTG", "LJ", "HJ", "CO", "BTN", "SB", "BB"};

// Hand indices for fast lookup
// Pairs: 0-12 (AA, KK, ..., 22)
// Suited: 13-90 (AKs, AQs, ..., 32s)
// Offsuit: 91-168 (AKo, AQo, ..., 32o)

struct Hand {
    std::string name;
    int combos;  // Number of combinations (6 for pairs, 4 for suited, 12 for offsuit)
    double strength;  // 0-100 hand strength rating
};

std::array<Hand, NUM_HANDS> HANDS;

void init_hands() {
    int idx = 0;

    // Hand strength approximations (empirically derived)
    std::unordered_map<std::string, double> strength_map = {
        {"AA", 85}, {"KK", 82}, {"QQ", 80}, {"JJ", 77}, {"TT", 75},
        {"99", 72}, {"88", 69}, {"77", 66}, {"66", 63}, {"55", 60},
        {"44", 57}, {"33", 54}, {"22", 51},
        {"AKs", 67}, {"AKo", 65}, {"AQs", 66}, {"AQo", 64}, {"AJs", 65}, {"AJo", 63},
        {"ATs", 64}, {"ATo", 62}, {"A9s", 61}, {"A8s", 60}, {"A7s", 59}, {"A6s", 58},
        {"A5s", 59}, {"A4s", 58}, {"A3s", 57}, {"A2s", 56},
        {"A9o", 58}, {"A8o", 57}, {"A7o", 55}, {"A6o", 54}, {"A5o", 55}, {"A4o", 54},
        {"A3o", 53}, {"A2o", 52},
        {"KQs", 63}, {"KQo", 61}, {"KJs", 62}, {"KJo", 60}, {"KTs", 61}, {"KTo", 59},
        {"K9s", 58}, {"K8s", 56}, {"K7s", 55}, {"K6s", 54}, {"K5s", 53}, {"K4s", 52},
        {"K3s", 51}, {"K2s", 50},
        {"K9o", 55}, {"K8o", 53}, {"K7o", 51}, {"K6o", 50}, {"K5o", 49}, {"K4o", 48},
        {"K3o", 47}, {"K2o", 46},
        {"QJs", 60}, {"QJo", 58}, {"QTs", 59}, {"QTo", 57}, {"Q9s", 56}, {"Q8s", 54},
        {"Q7s", 52}, {"Q6s", 51}, {"Q5s", 50}, {"Q4s", 49}, {"Q3s", 48}, {"Q2s", 47},
        {"Q9o", 53}, {"Q8o", 51}, {"Q7o", 49}, {"Q6o", 47}, {"Q5o", 46}, {"Q4o", 45},
        {"Q3o", 44}, {"Q2o", 43},
        {"JTs", 57}, {"JTo", 55}, {"J9s", 54}, {"J8s", 52}, {"J7s", 50}, {"J6s", 48},
        {"J5s", 47}, {"J4s", 46}, {"J3s", 45}, {"J2s", 44},
        {"J9o", 51}, {"J8o", 49}, {"J7o", 46}, {"J6o", 44}, {"J5o", 43}, {"J4o", 42},
        {"J3o", 41}, {"J2o", 40},
        {"T9s", 54}, {"T8s", 51}, {"T7s", 49}, {"T6s", 47}, {"T5s", 45}, {"T4s", 44},
        {"T3s", 43}, {"T2s", 42},
        {"T9o", 51}, {"T8o", 48}, {"T7o", 45}, {"T6o", 43}, {"T5o", 41}, {"T4o", 40},
        {"T3o", 39}, {"T2o", 38},
        {"98s", 50}, {"97s", 48}, {"96s", 46}, {"95s", 44}, {"94s", 42}, {"93s", 41}, {"92s", 40},
        {"98o", 47}, {"97o", 44}, {"96o", 42}, {"95o", 40}, {"94o", 38}, {"93o", 37}, {"92o", 36},
        {"87s", 48}, {"86s", 45}, {"85s", 43}, {"84s", 41}, {"83s", 39}, {"82s", 38},
        {"87o", 44}, {"86o", 41}, {"85o", 39}, {"84o", 37}, {"83o", 35}, {"82o", 34},
        {"76s", 46}, {"75s", 43}, {"74s", 41}, {"73s", 39}, {"72s", 37},
        {"76o", 42}, {"75o", 39}, {"74o", 37}, {"73o", 35}, {"72o", 33},
        {"65s", 44}, {"64s", 42}, {"63s", 40}, {"62s", 38},
        {"65o", 40}, {"64o", 38}, {"63o", 36}, {"62o", 34},
        {"54s", 43}, {"53s", 41}, {"52s", 39},
        {"54o", 39}, {"53o", 37}, {"52o", 35},
        {"43s", 40}, {"42s", 38},
        {"43o", 36}, {"42o", 34},
        {"32s", 38},
        {"32o", 34}
    };

    // Pairs
    for (int i = 0; i < NUM_RANKS; i++) {
        std::string name = std::string(1, RANKS[i]) + RANKS[i];
        double str = strength_map.count(name) ? strength_map[name] : 35.0;
        HANDS[idx++] = {name, 6, str};
    }

    // Suited
    for (int i = 0; i < NUM_RANKS; i++) {
        for (int j = i + 1; j < NUM_RANKS; j++) {
            std::string name = std::string(1, RANKS[i]) + RANKS[j] + "s";
            double str = strength_map.count(name) ? strength_map[name] : 35.0;
            HANDS[idx++] = {name, 4, str};
        }
    }

    // Offsuit
    for (int i = 0; i < NUM_RANKS; i++) {
        for (int j = i + 1; j < NUM_RANKS; j++) {
            std::string name = std::string(1, RANKS[i]) + RANKS[j] + "o";
            double str = strength_map.count(name) ? strength_map[name] : 35.0;
            HANDS[idx++] = {name, 12, str};
        }
    }
}

int hand_index(const std::string& name) {
    for (int i = 0; i < NUM_HANDS; i++) {
        if (HANDS[i].name == name) return i;
    }
    return -1;
}

// =============================================================================
// SCENARIO CONFIGURATION
// =============================================================================

enum class ScenarioType { RFI, FACING_OPEN, FACING_3BET };
enum class Action { FOLD = 0, CALL, RAISE, ALLIN, NUM_ACTIONS };

constexpr int MAX_ACTIONS = 4;

// Position indices for calculations (0 = earliest, 6 = latest)
int get_position_index(const std::string& pos) {
    if (pos == "UTG") return 0;
    if (pos == "LJ") return 1;
    if (pos == "HJ") return 2;
    if (pos == "CO") return 3;
    if (pos == "BTN") return 4;
    if (pos == "SB") return 5;
    if (pos == "BB") return 6;
    if (pos == "Blinds") return 6;
    return 3;  // Default to middle
}

// Positional advantage: how much better hero's position is vs villain
// Returns 0.0 (no advantage) to 1.0 (max advantage like BTN vs UTG)
double get_positional_advantage(const std::string& hero_pos, const std::string& villain_pos) {
    int hero_idx = get_position_index(hero_pos);
    int villain_idx = get_position_index(villain_pos);

    // Hero acts after villain postflop = advantage
    // BTN vs UTG: hero_idx=4, villain_idx=0 -> diff=4 -> high advantage
    // LJ vs UTG: hero_idx=1, villain_idx=0 -> diff=1 -> small advantage
    int diff = hero_idx - villain_idx;

    if (diff <= 0) return 0.0;  // No advantage if OOP

    // Scale: 1 position = 0.15, max out at ~0.6
    return std::min(0.6, diff * 0.15);
}

struct ScenarioConfig {
    ScenarioType type;
    std::string hero_pos;
    std::string villain_pos;
    double starting_pot;     // Pot before hero acts (BB)
    double hero_to_call;     // Amount to call (BB)
    double hero_invested;    // Hero's current investment
    double villain_invested; // Villain's investment
    double stack_size;       // Effective stack (BB)
    std::vector<double> raise_sizes;  // Available raise sizes
    double positional_advantage;  // 0.0-1.0 positional edge

    // Which actions are available
    bool can_fold = true;
    bool can_call = false;
    bool can_raise = true;
    bool can_allin = true;
};

ScenarioConfig create_rfi_config(const std::string& hero_pos) {
    ScenarioConfig cfg;
    cfg.type = ScenarioType::RFI;
    cfg.hero_pos = hero_pos;
    cfg.villain_pos = "Blinds";
    cfg.starting_pot = 1.5;
    cfg.hero_to_call = 0;
    cfg.hero_invested = (hero_pos == "SB") ? 0.5 : 0;
    cfg.villain_invested = 1.5;
    cfg.stack_size = 100.0;
    cfg.raise_sizes = {2.5, 3.0};
    cfg.can_call = false;  // Can't limp from most positions
    // BTN has positional advantage over blinds, SB has none
    cfg.positional_advantage = get_positional_advantage(hero_pos, "BB");
    return cfg;
}

ScenarioConfig create_facing_open_config(const std::string& hero_pos, const std::string& villain_pos) {
    ScenarioConfig cfg;
    cfg.type = ScenarioType::FACING_OPEN;
    cfg.hero_pos = hero_pos;
    cfg.villain_pos = villain_pos;
    cfg.starting_pot = 4.0;  // Blinds + open

    if (hero_pos == "BB") {
        cfg.hero_to_call = 1.5;
        cfg.hero_invested = 1.0;
    } else if (hero_pos == "SB") {
        cfg.hero_to_call = 2.0;
        cfg.hero_invested = 0.5;
    } else {
        cfg.hero_to_call = 2.5;
        cfg.hero_invested = 0;
    }

    cfg.villain_invested = 2.5;
    cfg.stack_size = 100.0;
    cfg.raise_sizes = {7.5, 9.0};
    cfg.can_call = true;
    // Positional advantage: BTN vs UTG has big edge, BB vs UTG has none
    cfg.positional_advantage = get_positional_advantage(hero_pos, villain_pos);
    return cfg;
}

ScenarioConfig create_facing_3bet_config(const std::string& hero_pos, const std::string& villain_pos) {
    ScenarioConfig cfg;
    cfg.type = ScenarioType::FACING_3BET;
    cfg.hero_pos = hero_pos;
    cfg.villain_pos = villain_pos;
    cfg.starting_pot = 11.5;  // Blinds + open + 3bet
    cfg.hero_to_call = 5.0;   // 7.5 - 2.5
    cfg.hero_invested = 2.5;  // Original open
    cfg.villain_invested = 7.5;
    cfg.stack_size = 100.0;
    cfg.raise_sizes = {22.0};
    cfg.can_call = true;
    // In 3-bet pots, positional advantage matters even more
    cfg.positional_advantage = get_positional_advantage(hero_pos, villain_pos);
    return cfg;
}

// =============================================================================
// RANGE GENERATION
// =============================================================================

std::array<double, NUM_HANDS> get_full_range() {
    std::array<double, NUM_HANDS> range;
    range.fill(1.0);
    return range;
}

std::array<double, NUM_HANDS> get_position_opening_range(const std::string& pos) {
    std::array<double, NUM_HANDS> range;
    range.fill(0.0);

    double threshold;
    if (pos == "UTG") threshold = 62;
    else if (pos == "LJ") threshold = 58;
    else if (pos == "HJ") threshold = 55;
    else if (pos == "CO") threshold = 50;
    else if (pos == "BTN") threshold = 45;
    else if (pos == "SB") threshold = 42;
    else threshold = 40;  // BB

    for (int i = 0; i < NUM_HANDS; i++) {
        if (HANDS[i].strength >= threshold) {
            range[i] = 1.0;
        }
    }

    return range;
}

std::array<double, NUM_HANDS> get_defending_range(const std::string& pos) {
    std::array<double, NUM_HANDS> range;
    range.fill(0.0);

    // BB defending range is wider
    double threshold = (pos == "BB") ? 42 : 48;

    for (int i = 0; i < NUM_HANDS; i++) {
        if (HANDS[i].strength >= threshold) {
            range[i] = 1.0;
        }
    }

    return range;
}

std::array<double, NUM_HANDS> get_3bet_range() {
    std::array<double, NUM_HANDS> range;
    range.fill(0.0);

    for (int i = 0; i < NUM_HANDS; i++) {
        // Value 3-bets: premium hands
        if (HANDS[i].strength >= 70) {
            range[i] = 1.0;
        }
        // Bluff 3-bets: suited aces, suited connectors
        else if (HANDS[i].strength >= 55 && HANDS[i].strength <= 62 &&
                 HANDS[i].name.back() == 's') {
            range[i] = 0.5;
        }
    }

    return range;
}

// =============================================================================
// CFR+ SOLVER
// =============================================================================

class PreflopCFR {
public:
    ScenarioConfig config;
    std::array<double, NUM_HANDS> hero_range;
    std::array<double, NUM_HANDS> villain_range;

    // CFR data: [hand_idx][action_idx]
    std::array<std::array<double, MAX_ACTIONS>, NUM_HANDS> regrets;
    std::array<std::array<double, MAX_ACTIONS>, NUM_HANDS> strategy_sum;

    int num_actions;
    int iterations = 0;

    PreflopCFR(const ScenarioConfig& cfg,
               const std::array<double, NUM_HANDS>& hero,
               const std::array<double, NUM_HANDS>& villain)
        : config(cfg), hero_range(hero), villain_range(villain) {

        // Initialize arrays
        for (auto& r : regrets) r.fill(0);
        for (auto& s : strategy_sum) s.fill(0);

        // Count available actions
        num_actions = 0;
        if (cfg.can_fold) num_actions++;
        if (cfg.can_call) num_actions++;
        if (cfg.can_raise) num_actions++;
        if (cfg.can_allin) num_actions++;
    }

    std::array<double, MAX_ACTIONS> get_strategy(int hand_idx) {
        std::array<double, MAX_ACTIONS> strategy;
        strategy.fill(0);

        double sum = 0;
        for (int a = 0; a < num_actions; a++) {
            strategy[a] = std::max(0.0, regrets[hand_idx][a]);
            sum += strategy[a];
        }

        if (sum > 0) {
            for (int a = 0; a < num_actions; a++) {
                strategy[a] /= sum;
            }
        } else {
            // Uniform if no positive regrets
            for (int a = 0; a < num_actions; a++) {
                strategy[a] = 1.0 / num_actions;
            }
        }

        return strategy;
    }

    std::array<double, MAX_ACTIONS> get_average_strategy(int hand_idx) {
        std::array<double, MAX_ACTIONS> strategy;
        strategy.fill(0);

        double sum = 0;
        for (int a = 0; a < num_actions; a++) {
            sum += strategy_sum[hand_idx][a];
        }

        if (sum > 0) {
            for (int a = 0; a < num_actions; a++) {
                strategy[a] = strategy_sum[hand_idx][a] / sum;
            }
        } else {
            for (int a = 0; a < num_actions; a++) {
                strategy[a] = 1.0 / num_actions;
            }
        }

        return strategy;
    }

    double get_equity_vs_range(int hand_idx) {
        double hero_str = HANDS[hand_idx].strength;
        double total_weight = 0;
        double weighted_equity = 0;

        for (int v = 0; v < NUM_HANDS; v++) {
            if (villain_range[v] <= 0) continue;

            double v_str = HANDS[v].strength;
            double w = villain_range[v] * HANDS[v].combos;

            // Logistic equity model
            double diff = hero_str - v_str;
            double equity = 1.0 / (1.0 + std::exp(-diff / 10.0));

            weighted_equity += equity * w;
            total_weight += w;
        }

        return (total_weight > 0) ? weighted_equity / total_weight : 0.5;
    }

    // Estimate villain fold/call/raise frequencies based on scenario
    // Villain folds more when hero has positional advantage
    std::tuple<double, double, double> estimate_villain_response(double raise_size) {
        double fold_freq, call_freq, raise_freq;

        if (config.type == ScenarioType::RFI) {
            // Blinds facing open
            fold_freq = 0.65 + (raise_size - 2.5) * 0.04;
            raise_freq = 0.12;
        } else if (config.type == ScenarioType::FACING_OPEN) {
            // Opener facing 3-bet
            fold_freq = 0.55 + (raise_size - 7.5) * 0.02;
            raise_freq = 0.15;
        } else {
            // 3-bettor facing 4-bet
            fold_freq = 0.50;
            raise_freq = 0.20;
        }

        // Villain folds more vs in-position opponent
        // BTN vs UTG (advantage=0.6): villain folds +6% more
        // This reflects the positional disadvantage postflop
        fold_freq += config.positional_advantage * 0.10;
        raise_freq -= config.positional_advantage * 0.05;  // Less likely to re-raise OOP

        fold_freq = std::max(0.1, std::min(0.9, fold_freq));
        raise_freq = std::max(0.05, std::min(0.3, raise_freq));
        call_freq = 1.0 - fold_freq - raise_freq;

        return {fold_freq, call_freq, raise_freq};
    }

    double get_action_ev(int hand_idx, int action_idx) {
        double equity = get_equity_vs_range(hand_idx);
        double hand_strength = HANDS[hand_idx].strength;

        int current_action = 0;

        // FOLD
        if (config.can_fold) {
            if (action_idx == current_action) {
                return -config.hero_invested;
            }
            current_action++;
        }

        // CALL
        if (config.can_call) {
            if (action_idx == current_action) {
                double total_pot = config.starting_pot + config.hero_to_call + config.villain_invested;
                return equity * total_pot - (1.0 - equity) * config.hero_to_call;
            }
            current_action++;
        }

        // RAISE
        if (config.can_raise) {
            if (action_idx == current_action) {
                double raise_size = config.raise_sizes.empty() ? 7.5 : config.raise_sizes[0];
                return get_raise_ev(hand_idx, raise_size, equity);
            }
            current_action++;
        }

        // ALLIN
        if (config.can_allin) {
            if (action_idx == current_action) {
                return get_raise_ev(hand_idx, config.stack_size, equity);
            }
        }

        return 0;
    }

    double get_raise_ev(int hand_idx, double raise_size, double equity) {
        auto response = estimate_villain_response(raise_size);
        double fold_freq = std::get<0>(response);
        double call_freq = std::get<1>(response);
        double raise_freq = std::get<2>(response);

        double hand_strength = HANDS[hand_idx].strength;

        // EV when villain folds - we win the pot
        double ev_fold = config.starting_pot + config.villain_invested;

        // EV when villain calls - we go to flop
        // Apply playability adjustment: weak hands play poorly postflop
        // Strong hands realize more equity, weak hands realize less
        double playability = get_playability(hand_idx);
        double realized_equity = equity * playability;

        double total_pot_call = config.starting_pot + raise_size + raise_size;
        // For RFI: we risk raise_size to win pot when called
        // Postflop EV is realized_equity * pot - (1 - realized_equity) * future_investment
        // Simplified: assume average postflop investment is 0.5 * remaining_stack when called
        double postflop_investment = (config.stack_size - raise_size) * 0.3;  // Average investment
        double ev_call = realized_equity * (total_pot_call + postflop_investment * 2)
                       - (1.0 - realized_equity) * (raise_size + postflop_investment);

        // EV when villain re-raises
        double ev_reraise;
        if (hand_strength >= 75) {  // Premium hands continue
            ev_reraise = realized_equity * (config.stack_size * 2)
                       - (1.0 - realized_equity) * config.stack_size;
        } else if (hand_strength >= 65) {  // Medium hands mix
            ev_reraise = 0.3 * (realized_equity * config.stack_size * 2
                              - (1.0 - realized_equity) * config.stack_size)
                       + 0.7 * (-raise_size);
        } else {
            ev_reraise = -raise_size;  // Fold to re-raise
        }

        return fold_freq * ev_fold + call_freq * ev_call + raise_freq * ev_reraise;
    }

    // Playability factor: how well a hand realizes its equity postflop
    // Premium pairs and big cards realize equity well
    // Weak offsuit hands realize poorly
    // Being in position significantly boosts equity realization
    double get_playability(int hand_idx) {
        double strength = HANDS[hand_idx].strength;
        const std::string& name = HANDS[hand_idx].name;

        // Base playability from hand strength
        double playability;
        if (strength >= 75) {
            playability = 1.0;  // Premiums realize full equity
        } else if (strength >= 60) {
            playability = 0.85;  // Strong hands
        } else if (strength >= 50) {
            playability = 0.70;  // Medium hands
        } else if (strength >= 40) {
            playability = 0.55;  // Weak hands
        } else {
            playability = 0.40;  // Trash hands realize equity poorly
        }

        // Suited hands play better
        if (name.back() == 's') {
            playability += 0.10;
        }

        // Connected hands play better (check if ranks are close)
        if (name.length() >= 2) {
            int r1 = -1, r2 = -1;
            for (int i = 0; i < NUM_RANKS; i++) {
                if (RANKS[i] == name[0]) r1 = i;
                if (RANKS[i] == name[1]) r2 = i;
            }
            if (r1 >= 0 && r2 >= 0 && std::abs(r1 - r2) <= 2) {
                playability += 0.05;  // Connected bonus
            }
        }

        // Positional advantage boost: being IP helps realize equity
        // BTN vs UTG (advantage=0.6) gets +0.12 playability
        // LJ vs UTG (advantage=0.15) gets +0.03 playability
        playability += config.positional_advantage * 0.20;

        return std::min(1.0, playability);
    }

    void train_iteration() {
        iterations++;

        for (int h = 0; h < NUM_HANDS; h++) {
            if (hero_range[h] <= 0) continue;

            auto strategy = get_strategy(h);

            // Calculate action EVs
            std::array<double, MAX_ACTIONS> action_evs;
            for (int a = 0; a < num_actions; a++) {
                action_evs[a] = get_action_ev(h, a);
            }

            // Expected EV under current strategy
            double expected_ev = 0;
            for (int a = 0; a < num_actions; a++) {
                expected_ev += strategy[a] * action_evs[a];
            }

            // Update regrets (CFR+)
            for (int a = 0; a < num_actions; a++) {
                double regret = action_evs[a] - expected_ev;
                regrets[h][a] = std::max(0.0, regrets[h][a] + regret);
            }

            // Update strategy sum (linear weighting)
            for (int a = 0; a < num_actions; a++) {
                strategy_sum[h][a] += iterations * strategy[a];
            }
        }
    }

    void train(int num_iterations, bool verbose = true) {
        auto start = std::chrono::high_resolution_clock::now();

        for (int i = 0; i < num_iterations; i++) {
            train_iteration();

            if (verbose && (i + 1) % (num_iterations / 10) == 0) {
                std::cerr << "  Iteration " << (i + 1) << "/" << num_iterations << std::endl;
            }
        }

        auto end = std::chrono::high_resolution_clock::now();
        auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(end - start);

        if (verbose) {
            std::cerr << "  Training complete: " << iterations << " iterations in "
                      << duration.count() << "ms" << std::endl;
        }
    }

    double compute_exploitability() {
        double total_regret = 0;
        double total_weight = 0;

        for (int h = 0; h < NUM_HANDS; h++) {
            if (hero_range[h] <= 0) continue;

            double weight = hero_range[h] * HANDS[h].combos;
            auto strategy = get_average_strategy(h);

            std::array<double, MAX_ACTIONS> action_evs;
            for (int a = 0; a < num_actions; a++) {
                action_evs[a] = get_action_ev(h, a);
            }

            double best_ev = *std::max_element(action_evs.begin(), action_evs.begin() + num_actions);
            double current_ev = 0;
            for (int a = 0; a < num_actions; a++) {
                current_ev += strategy[a] * action_evs[a];
            }

            total_regret += weight * (best_ev - current_ev);
            total_weight += weight;
        }

        return (total_weight > 0) ? total_regret / total_weight : 0;
    }
};

// =============================================================================
// JSON OUTPUT
// =============================================================================

std::string action_name(int idx, const ScenarioConfig& cfg) {
    int current = 0;
    if (cfg.can_fold) {
        if (idx == current) return "fold";
        current++;
    }
    if (cfg.can_call) {
        if (idx == current) return "call";
        current++;
    }
    if (cfg.can_raise) {
        if (idx == current) return "raise";
        current++;
    }
    if (cfg.can_allin) {
        if (idx == current) return "raise_all_in";
    }
    return "unknown";
}

void output_json(PreflopCFR& solver, std::ostream& out) {
    out << "{\n";
    out << "  \"scenario\": {\n";
    out << "    \"hero_pos\": \"" << solver.config.hero_pos << "\",\n";
    out << "    \"villain_pos\": \"" << solver.config.villain_pos << "\",\n";
    out << "    \"type\": \"" << (solver.config.type == ScenarioType::RFI ? "RFI" :
                                  solver.config.type == ScenarioType::FACING_OPEN ? "FACING_OPEN" : "FACING_3BET") << "\"\n";
    out << "  },\n";
    out << "  \"iterations\": " << solver.iterations << ",\n";
    out << "  \"exploitability\": " << std::fixed << std::setprecision(6) << solver.compute_exploitability() << ",\n";
    out << "  \"strategy\": {\n";

    bool first = true;
    for (int h = 0; h < NUM_HANDS; h++) {
        if (solver.hero_range[h] <= 0) continue;

        auto strategy = solver.get_average_strategy(h);

        if (!first) out << ",\n";
        first = false;

        out << "    \"" << HANDS[h].name << "\": {";

        bool first_action = true;
        for (int a = 0; a < solver.num_actions; a++) {
            if (strategy[a] < 0.005) continue;  // Skip tiny frequencies

            if (!first_action) out << ", ";
            first_action = false;

            out << "\"" << action_name(a, solver.config) << "\": "
                << std::fixed << std::setprecision(4) << strategy[a];
        }
        out << "}";
    }

    out << "\n  }\n";
    out << "}\n";
}

// =============================================================================
// MAIN
// =============================================================================

void print_usage() {
    std::cerr << "Usage: preflop_cfr [options]\n"
              << "Options:\n"
              << "  --scenario TYPE    rfi, facing_open, facing_3bet\n"
              << "  --hero POS         UTG, LJ, HJ, CO, BTN, SB, BB\n"
              << "  --villain POS      (for facing_open/facing_3bet)\n"
              << "  --iterations N     Number of CFR iterations (default: 10000)\n"
              << "  --output FILE      Output file (default: stdout)\n"
              << "  --quiet            Suppress progress output\n";
}

int main(int argc, char* argv[]) {
    // Initialize hands
    init_hands();

    // Parse arguments
    std::string scenario_type = "rfi";
    std::string hero_pos = "UTG";
    std::string villain_pos = "BB";
    int iterations = 10000;
    std::string output_file;
    bool verbose = true;

    for (int i = 1; i < argc; i++) {
        std::string arg = argv[i];
        if (arg == "--scenario" && i + 1 < argc) {
            scenario_type = argv[++i];
        } else if (arg == "--hero" && i + 1 < argc) {
            hero_pos = argv[++i];
        } else if (arg == "--villain" && i + 1 < argc) {
            villain_pos = argv[++i];
        } else if (arg == "--iterations" && i + 1 < argc) {
            iterations = std::stoi(argv[++i]);
        } else if (arg == "--output" && i + 1 < argc) {
            output_file = argv[++i];
        } else if (arg == "--quiet") {
            verbose = false;
        } else if (arg == "--help") {
            print_usage();
            return 0;
        }
    }

    // Create scenario config
    ScenarioConfig config;
    std::array<double, NUM_HANDS> hero_range;
    std::array<double, NUM_HANDS> villain_range;

    if (scenario_type == "rfi") {
        config = create_rfi_config(hero_pos);
        hero_range = get_full_range();
        villain_range = get_defending_range("BB");
    } else if (scenario_type == "facing_open") {
        config = create_facing_open_config(hero_pos, villain_pos);
        hero_range = get_full_range();
        villain_range = get_position_opening_range(villain_pos);
    } else if (scenario_type == "facing_3bet") {
        config = create_facing_3bet_config(hero_pos, villain_pos);
        hero_range = get_position_opening_range(hero_pos);
        villain_range = get_3bet_range();
    } else {
        std::cerr << "Unknown scenario type: " << scenario_type << std::endl;
        return 1;
    }

    if (verbose) {
        std::cerr << "Solving " << hero_pos;
        if (scenario_type != "rfi") {
            std::cerr << " vs " << villain_pos;
        }
        std::cerr << " (" << scenario_type << ")..." << std::endl;
    }

    // Run solver
    PreflopCFR solver(config, hero_range, villain_range);
    solver.train(iterations, verbose);

    // Output results
    if (output_file.empty()) {
        output_json(solver, std::cout);
    } else {
        std::ofstream out(output_file);
        output_json(solver, out);
    }

    return 0;
}
