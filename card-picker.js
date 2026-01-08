/**
 * Card Picker Component for Board Card Selection
 * Allows users to select flop/turn/river cards
 */

class CardPicker {
    constructor() {
        this.selectedCards = [];
        this.maxCards = 3; // flop = 3, turn = 1, river = 1
        this.onConfirm = null;
        this.modal = null;
        this.mode = 'flop'; // 'flop', 'turn', or 'river'

        this.ranks = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
        this.suits = ['s', 'h', 'd', 'c']; // spades, hearts, diamonds, clubs
        this.suitSymbols = {
            's': '♠',
            'h': '♥',
            'd': '♦',
            'c': '♣'
        };
        this.suitColors = {
            's': '#4a5568', // gray
            'h': '#c53030', // red
            'd': '#2b6cb0', // blue
            'c': '#38a169'  // green
        };
    }

    /**
     * Show the card picker modal
     * @param {string} mode - 'flop', 'turn', or 'river'
     * @param {Function} callback - Called with selected cards on confirm
     * @param {Array} existingBoard - Already selected board cards to exclude
     */
    show(mode = 'flop', callback, existingBoard = []) {
        this.mode = mode;
        this.maxCards = mode === 'flop' ? 3 : 1;
        this.selectedCards = [];
        this.onConfirm = callback;
        this.existingBoard = existingBoard;

        this.createModal();
        this.modal.style.display = 'flex';
    }

    hide() {
        if (this.modal) {
            this.modal.style.display = 'none';
        }
    }

    createModal() {
        if (this.modal) {
            this.modal.remove();
        }

        const modal = document.createElement('div');
        modal.className = 'card-picker-modal';
        modal.innerHTML = `
            <div class="card-picker-overlay"></div>
            <div class="card-picker-content">
                <button class="card-picker-close">&times;</button>

                <h2 class="card-picker-title">
                    Select ${this.mode === 'flop' ? 'Flop Cards (3)' : this.mode === 'turn' ? 'Turn Card (1)' : 'River Card (1)'}
                </h2>

                <!-- Selected cards display -->
                <div class="card-picker-selected">
                    ${Array(this.maxCards).fill(0).map((_, i) =>
                        `<div class="card-picker-slot" data-slot="${i}">
                            <div class="card-back"></div>
                        </div>`
                    ).join('')}
                </div>

                <!-- Card grid -->
                <div class="card-picker-grid">
                    ${this.suits.map(suit => `
                        <div class="card-picker-row">
                            ${this.ranks.map(rank => {
                                const card = rank + suit;
                                const isDisabled = this.existingBoard.includes(card);
                                return `
                                    <button
                                        class="card-picker-card ${isDisabled ? 'disabled' : ''}"
                                        data-card="${card}"
                                        style="background-color: ${this.suitColors[suit]}"
                                        ${isDisabled ? 'disabled' : ''}
                                    >
                                        <span class="card-suit">${this.suitSymbols[suit]}</span>
                                        <span class="card-rank">${rank}</span>
                                    </button>
                                `;
                            }).join('')}
                        </div>
                    `).join('')}
                </div>

                <!-- Action buttons -->
                <div class="card-picker-actions">
                    <button class="card-picker-btn card-picker-random">
                        <span>🔄</span> Random
                    </button>
                    <button class="card-picker-btn card-picker-cancel">Close</button>
                    <button class="card-picker-btn card-picker-confirm" disabled>Confirm</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.modal = modal;

        // Add event listeners
        this.attachEventListeners();
    }

    attachEventListeners() {
        // Close button
        this.modal.querySelector('.card-picker-close').addEventListener('click', () => this.hide());
        this.modal.querySelector('.card-picker-overlay').addEventListener('click', () => this.hide());

        // Cancel button
        this.modal.querySelector('.card-picker-cancel').addEventListener('click', () => this.hide());

        // Confirm button
        this.modal.querySelector('.card-picker-confirm').addEventListener('click', () => {
            if (this.selectedCards.length === this.maxCards && this.onConfirm) {
                this.onConfirm(this.selectedCards);
                this.hide();
            }
        });

        // Random button
        this.modal.querySelector('.card-picker-random').addEventListener('click', () => {
            this.selectRandomCards();
        });

        // Card buttons
        const cardButtons = this.modal.querySelectorAll('.card-picker-card:not(.disabled)');
        cardButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const card = e.currentTarget.dataset.card;
                this.toggleCard(card, e.currentTarget);
            });
        });
    }

    toggleCard(card, buttonElement) {
        const index = this.selectedCards.indexOf(card);

        if (index >= 0) {
            // Deselect
            this.selectedCards.splice(index, 1);
            buttonElement.classList.remove('selected');
        } else {
            // Select if under limit
            if (this.selectedCards.length < this.maxCards) {
                this.selectedCards.push(card);
                buttonElement.classList.add('selected');
            }
        }

        this.updateSelectedDisplay();
        this.updateConfirmButton();
    }

    updateSelectedDisplay() {
        const slots = this.modal.querySelectorAll('.card-picker-slot');
        slots.forEach((slot, i) => {
            const card = this.selectedCards[i];
            if (card) {
                const rank = card[0];
                const suit = card[1];
                slot.innerHTML = `
                    <div class="selected-card" style="background-color: ${this.suitColors[suit]}">
                        <span class="card-suit">${this.suitSymbols[suit]}</span>
                        <span class="card-rank">${rank}</span>
                    </div>
                `;
            } else {
                slot.innerHTML = '<div class="card-back"></div>';
            }
        });
    }

    updateConfirmButton() {
        const confirmBtn = this.modal.querySelector('.card-picker-confirm');
        if (this.selectedCards.length === this.maxCards) {
            confirmBtn.disabled = false;
            confirmBtn.classList.add('active');
        } else {
            confirmBtn.disabled = true;
            confirmBtn.classList.remove('active');
        }
    }

    selectRandomCards() {
        // Clear current selection
        this.selectedCards = [];
        const cardButtons = this.modal.querySelectorAll('.card-picker-card:not(.disabled)');
        cardButtons.forEach(btn => btn.classList.remove('selected'));

        // Get available cards (not in existingBoard)
        const availableCards = [];
        this.suits.forEach(suit => {
            this.ranks.forEach(rank => {
                const card = rank + suit;
                if (!this.existingBoard.includes(card)) {
                    availableCards.push(card);
                }
            });
        });

        // Randomly select cards
        const shuffled = availableCards.sort(() => Math.random() - 0.5);
        const selected = shuffled.slice(0, this.maxCards);

        // Apply selection
        selected.forEach(card => {
            const btn = this.modal.querySelector(`[data-card="${card}"]`);
            if (btn) {
                this.selectedCards.push(card);
                btn.classList.add('selected');
            }
        });

        this.updateSelectedDisplay();
        this.updateConfirmButton();
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CardPicker;
}
