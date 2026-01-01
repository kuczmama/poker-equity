/**
 * LLM Service
 * Handles communication with OpenRouter API
 */
class LLMService {
    constructor() {
        this.apiKey = localStorage.getItem('openrouter_api_key') || '';
        this.baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
        this.model = localStorage.getItem('openrouter_model') || 'google/gemini-2.0-pro-exp-02-05:free';
    }

    setApiKey(key) {
        this.apiKey = key;
        localStorage.setItem('openrouter_api_key', key);
    }

    setModel(model) {
        this.model = model;
        localStorage.setItem('openrouter_model', model);
    }

    hasApiKey() {
        return !!this.apiKey;
    }

    async analyze(context) {
        if (!this.apiKey) {
            throw new Error('API Key missing');
        }

        const systemPrompt = `
You are a Poker Strategy Expert specializing in Micro-Stakes GTO and Exploitative adjustments.
Your goal is to interpret GTO ranges for the user and provide actionable advice.

CONTEXT PROVIDED:
- Scenario: ${context.scenarioName}
- Hero Position: ${context.heroPos}
- Hand: ${context.hand}
- GTO Strategy: ${JSON.stringify(context.strategy)}
- Board (if any): ${context.board || 'Preflop'}

INSTRUCTIONS:
1. State the GTO frequency clearly (e.g., "GTO opens this 15% of the time").
2. Explain the *logic* (why is it mixed? Board coverage? Blocker?).
3. Provide a Micro-Stakes Adjustment (should they over-fold or over-bluff this specific spot vs population?).
4. Keep it concise (< 150 words).
        `;

        try {
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'HTTP-Referer': window.location.origin, // Required by OpenRouter
                    'X-Title': 'Poker Odds Calculator', // Optional
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: `Analyze ${context.hand} in ${context.scenarioName}` }
                    ]
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error?.message || 'API Request failed');
            }

            const data = await response.json();
            return data.choices[0].message.content;

        } catch (error) {
            console.error('LLM Error:', error);
            throw error;
        }
    }

    // New method for full hand history analysis
    async analyzeHandHistory(data) {
        if (!this.apiKey) throw new Error('API Key missing');

        // Hallucination Check: If no GTO strategy found, we fail fast or warn.
        let strategyInfo = "";
        if (data.gtoStrategy) {
            strategyInfo = `- GTO Strategy for ${data.heroHand}: ${JSON.stringify(data.gtoStrategy)}`;
        } else {
            strategyInfo = `- GTO Strategy: NOT FOUND in database (Use general poker theory)`;
        }

        let villainInfo = `- Relevant Villain: ${data.villainPos} (Name: ${data.villainName || 'Unknown'})`;
        if (data.villainStats) {
            villainInfo += `\n- Villain Stats (PT4): VPIP: ${data.villainStats.vpip.toFixed(1)}, PFR: ${data.villainStats.pfr.toFixed(1)}, 3Bet: ${data.villainStats.three_bet.toFixed(1)}, Hands: ${data.villainStats.hands}`;
        }

        const systemPrompt = `
You are a Poker Analyst. I have pre-calculated the exact game state for you.
DO NOT hallucinate pot odds, positions, or stack sizes. Use the provided values.

GAME STATE:
- Hero: ${data.heroName} (${data.heroPos})
- Hand: ${data.heroHand}
- Action to Analyze: ${data.actionType}
- Pot Odds: ${data.potOdds ? data.potOdds.toFixed(1) + '%' : 'N/A'} (Required Equity)
- Hand Equity: ${data.equity ? data.equity.toFixed(1) + '%' : 'N/A'} (Estimated vs Range)
${villainInfo}

GTO DATA (Ground Truth):
${strategyInfo}

TASK:
1. Compare Hero's actual play vs the GTO frequency provided above (if available).
2. If Pot Odds < Equity, highlight it as a mathematical call/value bet.
3. Incorporate Villain Stats if available (e.g., if VPIP > 40, they are a fish; if 3Bet < 3, they are a nit).
4. Be ruthless about deviations from the GTO strategy provided.
5. If GTO data is missing, rely on standard 100bb GTO principles for 6-max/7-max NLHE.
`;

        try {
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'HTTP-Referer': window.location.origin,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: `Here is the full hand history:\n\n${data.rawHistory}` }
                    ]
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error?.message || 'API Request failed');
            }

            const resData = await response.json();
            return resData.choices[0].message.content;

        } catch (error) {
            console.error('LLM Error:', error);
            throw error;
        }
    }
}
