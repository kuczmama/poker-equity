# Texas Hold'em Poker Odds Calculator

A modern, responsive web application for calculating poker hand odds and comparing the relative strength of two Texas Hold'em hands.

## Features

- **Hand Comparison**: Compare any two poker hands (e.g., 22 vs AKo)
- **Accurate Odds**: Uses Monte Carlo simulation with 50,000 iterations for precise calculations
- **Modern UI**: Beautiful, responsive design with smooth animations
- **Hand Notation Support**: Standard poker notation (22, AKo, AKs, QJs, etc.)
- **Real-time Validation**: Instant feedback on hand input validity
- **Example Hands**: Quick-start buttons for common hand comparisons

## Hand Notation

The calculator supports standard poker hand notation:

- **Pocket Pairs**: `22`, `AA`, `KK`, etc.
- **Suited Hands**: `AKs` (Ace-King suited), `QJs` (Queen-Jack suited)
- **Offsuit Hands**: `AKo` (Ace-King offsuit), `QJo` (Queen-Jack offsuit)

## Usage

1. Open `index.html` in a web browser
2. Enter two hands in the input fields (e.g., "22" and "AKo")
3. Click "Calculate Odds" or press Enter
4. View the results showing each hand's equity percentage

## Example Results

- **22 vs AKo**: 22 has ~52.65% equity vs AKo's ~47.35% equity
- **AKs vs AQs**: AKs has ~74.7% equity vs AQs's ~25.3% equity
- **QQ vs JJ**: QQ has ~81.2% equity vs JJ's ~18.8% equity

## Technical Details

- **Frontend**: Pure HTML, CSS, and JavaScript (no dependencies)
- **Algorithm**: Monte Carlo simulation with comprehensive hand evaluation
- **Hand Evaluation**: Full 7-card poker hand ranking (Royal Flush to High Card)
- **Performance**: Optimized for fast calculations while maintaining accuracy

## Deployment

This is a static website that can be deployed to any web hosting service:

- **GitHub Pages**: Simply push to a repository and enable Pages
- **Netlify**: Drag and drop the folder
- **Vercel**: Connect to a Git repository
- **Any Static Host**: Upload all files to a web server

## Files

- `index.html` - Main HTML structure
- `style.css` - Modern, responsive styling
- `poker-logic.js` - Core poker hand parsing and evaluation logic
- `app.js` - Main application logic and UI interactions
- `README.md` - This documentation

## Browser Support

Compatible with all modern browsers that support ES6+ features:
- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+
# poker-equity
