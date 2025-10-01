// Main application logic

class PokerOddsApp {
    constructor() {
        this.initializeElements();
        this.bindEvents();
        this.updateHandPreviews();
    }

    initializeElements() {
        this.hand1Input = document.getElementById('hand1');
        this.hand2Input = document.getElementById('hand2');
        this.calculateBtn = document.getElementById('calculate-btn');
        this.results = document.getElementById('results');
        this.hand1Preview = document.getElementById('hand1-preview');
        this.hand2Preview = document.getElementById('hand2-preview');
        
        // Result elements
        this.hand1Info = document.getElementById('hand1-info');
        this.hand2Info = document.getElementById('hand2-info');
        this.hand1Equity = document.getElementById('hand1-equity');
        this.hand2Equity = document.getElementById('hand2-equity');
        this.hand1Progress = document.getElementById('hand1-progress');
        this.hand2Progress = document.getElementById('hand2-progress');
        this.hand1Type = document.getElementById('hand1-type');
        this.hand2Type = document.getElementById('hand2-type');
        this.simulationInfo = document.getElementById('simulation-info');
        
        this.exampleBtns = document.querySelectorAll('.example-btn');
    }

    bindEvents() {
        this.calculateBtn.addEventListener('click', () => this.calculateOdds());
        
        this.hand1Input.addEventListener('input', () => {
            this.updateHandPreview(this.hand1Input.value, this.hand1Preview);
        });
        
        this.hand2Input.addEventListener('input', () => {
            this.updateHandPreview(this.hand2Input.value, this.hand2Preview);
        });
        
        // Enter key support
        this.hand1Input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.calculateOdds();
        });
        
        this.hand2Input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.calculateOdds();
        });
        
        // Example buttons
        this.exampleBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const hand1 = btn.dataset.hand1;
                const hand2 = btn.dataset.hand2;
                this.hand1Input.value = hand1;
                this.hand2Input.value = hand2;
                this.updateHandPreviews();
                this.calculateOdds();
            });
        });
    }

    updateHandPreviews() {
        this.updateHandPreview(this.hand1Input.value, this.hand1Preview);
        this.updateHandPreview(this.hand2Input.value, this.hand2Preview);
    }

    updateHandPreview(handValue, previewElement) {
        try {
            if (handValue.trim() === '') {
                previewElement.textContent = '';
                previewElement.className = 'hand-preview';
                return;
            }
            
            const hand = new PokerHand(handValue);
            previewElement.textContent = hand.getHandType();
            previewElement.className = 'hand-preview valid';
        } catch (error) {
            previewElement.textContent = 'Invalid hand';
            previewElement.className = 'hand-preview invalid';
        }
    }

    async calculateOdds() {
        const hand1Value = this.hand1Input.value.trim();
        const hand2Value = this.hand2Input.value.trim();
        
        if (!hand1Value || !hand2Value) {
            alert('Please enter both hands');
            return;
        }
        
        try {
            // Validate hands
            const hand1 = new PokerHand(hand1Value);
            const hand2 = new PokerHand(hand2Value);
            
            // Show loading state
            this.calculateBtn.textContent = 'Calculating...';
            this.calculateBtn.disabled = true;
            
            // Calculate odds (using async to prevent UI blocking)
            const results = await this.runCalculation(hand1Value, hand2Value);
            
            this.displayResults(results, hand1, hand2);
            
        } catch (error) {
            alert(`Error: ${error.message}`);
        } finally {
            this.calculateBtn.textContent = 'Calculate Odds';
            this.calculateBtn.disabled = false;
        }
    }

    runCalculation(hand1Value, hand2Value) {
        return new Promise((resolve) => {
            // Use setTimeout to allow UI updates
            setTimeout(() => {
                const results = OddsCalculator.calculateOdds(hand1Value, hand2Value, 100000);
                resolve(results);
            }, 10);
        });
    }

    displayResults(results, hand1, hand2) {
        // Update hand information
        this.hand1Info.textContent = hand1.getHandType();
        this.hand2Info.textContent = hand2.getHandType();
        
        // Update equity percentages
        this.hand1Equity.textContent = `${results.hand1Equity.toFixed(1)}%`;
        this.hand2Equity.textContent = `${results.hand2Equity.toFixed(1)}%`;
        
        // Update progress bar (single bar showing hand1 percentage)
        this.hand1Progress.style.width = `${results.hand1Equity}%`;
        
        // Update hand types
        this.hand1Type.textContent = hand1.getHandType();
        this.hand2Type.textContent = hand2.getHandType();
        
        // Update simulation info
        this.simulationInfo.textContent = `${results.iterations.toLocaleString()} hands simulated`;
        
        // Show results
        this.results.style.display = 'block';
        
        // Scroll to results
        this.results.scrollIntoView({ behavior: 'smooth' });
    }
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new PokerOddsApp();
});
