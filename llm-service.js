/**
 * LLM Service
 * Handles communication with OpenRouter API
 */
class LLMService {
    constructor() {
        this.apiKey = localStorage.getItem('openrouter_api_key') || '';
        this.baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
        this.model = 'anthropic/claude-3-haiku'; // Good default: cheap & fast
    }

    setApiKey(key) {
        this.apiKey = key;
        localStorage.setItem('openrouter_api_key', key);
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
}

