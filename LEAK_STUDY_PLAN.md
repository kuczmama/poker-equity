# Poker Leak Study Plan

## Your Identified Leaks

Based on your hand history analysis, you have the following leaks to fix:

| Priority | Leak | Impact |
|----------|------|--------|
| 🔴 HIGH | Calling 4-bets too loose | -$$ per session |
| 🔴 HIGH | Hero calling river shoves on completed draws | -$$ per session |
| 🟡 MED | Overvaluing top pair vs heavy aggression | -$ per session |
| 🟡 MED | Not folding dominated hands preflop | -$ per session |

---

## Week 1-2: Preflop 4-Bet Defense

### The Rule
When you 3-bet and face a 4-bet, your calling range should be MUCH tighter than you think.

### GTO 4-Bet Calling Ranges

#### BTN vs EP 4-Bet (Tightest)
```
CALL:  AA, KK, QQ, AKs, AKo
FOLD:  JJ, TT, AQs, AQo, KQs, QJs — ALL OF THESE
```

#### BTN vs CO 4-Bet
```
CALL:  AA, KK, QQ, JJ, AKs, AKo
FOLD:  TT, AQs, AQo, KQs, QJs
```

#### BTN vs BB 4-Bet (Widest — but still tight!)
```
CALL:  AA, KK, QQ, JJ, TT, AKs, AKo, AQs
FOLD:  99, AQo, KQs, QJs
```

### Hands You Were Misplaying

| Hand | What You Did | GTO Play |
|------|-------------|----------|
| QJo | Called 4-bet | **ALWAYS FOLD** |
| ATs | Called 4-bet | **FOLD** vs EP, marginal vs BTN |
| JJ | Called 4-bet vs UTG | **FOLD** vs EP 4-bets |

### Daily Practice
1. Open `leak-quiz.html` and run **10 "Facing 4-Bet" scenarios**
2. Before each session, write: "I fold JJ to 4-bets from EP"
3. Track every 4-bet spot — did you follow the chart?

---

## Week 3-4: River Play on Scary Boards

### The Rule
When a flush or straight completes and villain makes a BIG bet (>75% pot) or shoves:

| Your Hand | Flush Completes | Straight Completes |
|-----------|----------------|-------------------|
| One Pair | **FOLD** | **FOLD** |
| Two Pair | **FOLD** (no blocker) | **FOLD** |
| Set | **CALL** | **CALL** |
| Flush/Straight+ | **CALL** | **CALL** |

### Why This Works at Microstakes
- Players bluff rivers ~15-20% (not the 33%+ GTO requires)
- When they shove, they have it 80%+ of the time
- Your "hero calls" are losing -$$ long term

### The River Decision Flowchart

```
River completes obvious draw?
    │
    ├── NO → Normal hand reading
    │
    └── YES → Villain bets big (>75% pot)?
              │
              ├── NO → Consider calling with strong hands
              │
              └── YES → Do I have a flush/straight/set+?
                        │
                        ├── YES → CALL
                        │
                        └── NO → FOLD (even two pair!)
```

### Hands You Were Misplaying

| Hand | Board | Villain Action | You Did | Correct |
|------|-------|---------------|---------|---------|
| AcJc | Ad Jd 6c Qs **9d** | All-in | Called | **FOLD** |
| KcJc | Ts 7c 3h Js **6s** | All-in 2x pot | Called | **FOLD** |

### Daily Practice
1. Run **10 "River Decisions" in leak-quiz.html**
2. Review every river shove you faced — write down:
   - Board texture
   - Bet size
   - What you had
   - What you did
   - Was it correct?

---

## Week 5-6: Facing 3-Bets

### The Rule
When you open and face a 3-bet:
- **4-BET** with premiums (AA, KK, QQ, AKs, AKo)
- **CALL** with strong hands that play well postflop
- **FOLD** marginal hands, especially OOP

### 3-Bet Defense by Position

#### UTG Open, Face 3-Bet from BTN
```
4-BET: AA, KK, AKs
CALL:  QQ, JJ, TT, AKo, AQs
FOLD:  99, AQo, AJs, KQs
```

#### CO Open, Face 3-Bet from BTN
```
4-BET: AA, KK, QQ, AKs, AKo
CALL:  JJ, TT, 99, AQs, AQo, AJs, KQs
FOLD:  88, ATs, KJs, QJs
```

#### BTN Open, Face 3-Bet from BB (Widest)
```
4-BET: AA, KK, QQ, AKs, AKo
CALL:  JJ, TT, 99, 88, 77, AQs, AQo, AJs, KQs, ATs, KJs, QJs
FOLD:  66-, JTs, T9s, A5s, KJo, QJo
```

### Daily Practice
1. Run **10 "Facing 3-Bet" scenarios in leak-quiz.html**
2. Note every hand where you face a 3-bet
3. Review: "Was this in my calling range?"

---

## Week 7-8: Responding to Aggression

### The Rule
When you bet and get RAISED, your one-pair hands are usually beat.

| Scenario | Response with One Pair |
|----------|----------------------|
| You bet, villain raises | Call once, fold to another raise |
| You check-raise, villain 3-bets | **FOLD** |
| You bet, villain shoves | **FOLD** (unless set+) |

### Key Insight
At microstakes, aggression = strength. When they raise your raise, they're not bluffing.

### Hands You Were Misplaying

| Hand | Your Action | Villain Response | You Did | Correct |
|------|------------|-----------------|---------|---------|
| AsTs | Check-raise turn | 3-bet all-in | Called | **FOLD** |

---

## Quick Reference Card

### 🛑 STOP AND FOLD WHEN:
- [ ] You have 1 pair/2 pair AND flush/straight completes AND villain shoves
- [ ] You 3-bet marginal hand AND get 4-bet (QJo, KJo, ATo = FOLD)
- [ ] You bet/raise AND get re-raised AND you only have top pair
- [ ] Villain's line screams strength (at micros, they're not bluffing enough)

### ✅ CALL A 4-BET WITH:
- [ ] QQ+ (sometimes fold QQ vs tight EP players)
- [ ] AKs, AKo
- [ ] AQs (only vs BTN/SB 4-bettors)
- [ ] **NOT:** QJo, KJo, ATo, JJ vs EP, etc.

---

## Tracking Sheet

| Date | Session | 4-Bet Spots | Correct? | River Shoves | Correct? | Notes |
|------|---------|-------------|----------|--------------|----------|-------|
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |

---

## Using the Quiz

1. Open `leak-quiz.html` in your browser
2. Select a quiz mode:
   - **Facing 4-Bets** - Drill your 4-bet calling range
   - **Facing 3-Bets** - Drill your 3-bet defense
   - **River Decisions** - Drill scary river spots
   - **Mixed** - Random scenarios from all categories
3. Answer each scenario with **Fold**, **Call**, or **Raise**
4. Review the GTO explanation after each answer
5. Check your leak analysis at the end

### Goal Scores
- Week 1-2: 60%+ on 4-bet quiz
- Week 3-4: 70%+ on river quiz
- Week 5-6: 70%+ on 3-bet quiz
- Week 7-8: 80%+ on mixed quiz

---

## Resources

- **leak-quiz.html** - Interactive quiz for drilling scenarios
- **range-visual.html** - Visualize opening and 3-bet ranges
- **bet-sizing.html** - Calculate EV for different bet sizes
- **hand-analysis.html** - Paste hand histories for review

Good luck! 🎯

