# Sonar & Salvo

A browser-based naval battle card game. Hide your fleet, hunt the enemy's, and play cards from a shared deck to scout, strike, repair, and deceive. You play against a computer opponent.

Plain HTML, CSS and JavaScript. No build step and no dependencies.

## Run it locally

You need any static file server. From the project folder:

```bash
# Python 3 (preinstalled on macOS)
python3 -m http.server 8000

# or Node.js
npx serve -l 8000 .
```

Then open <http://localhost:8000>.

You can also just open `index.html` directly in a browser.

## How to play

1. **Deploy.** Place your fleet on the 10×10 grid: Carrier (5), Battleship (4), Cruiser (3), Submarine (3), Destroyer (2). Click a ship and then the grid, press <kbd>R</kbd> to rotate, or hit **Randomize**.
2. **Battle.** Take turns firing at enemy waters. The first player to sink every enemy ship wins.
3. **Cards.** Both players draw from one **shared deck** of 46 cards. Attack and most utility cards have 2 copies; the defensive cards (Field Repair, Full Maintenance, Move, Call for Backup, Rocket Shield, Decoy, Smoke Screen, Scrambler) have 1 copy each, to keep games short.
   - You start with **2 cards** and draw **1 at the start of every turn**. You can hold at most **4**. With a full hand you skip that turn's draw. The discard pile is reshuffled when the deck runs out.
   - **Single-use cards** (Field Repair, Full Maintenance, Move, Call for Backup) stay in the discard pile once played. They are never reshuffled into the deck and can't be salvaged.
   - **Comeback draw:** when one of your ships is sunk, you draw a bonus card (if you have room).
4. **A turn:**
   1. Optionally play **one utility card**.
   2. Then **either** take your **regular shot**, **or** play **one attack card instead** of it. Either one ends your turn.

   Care Package doesn't count toward these limits. Double Salvo gives you two regular shots.

### Cards

| Card | Type | Effect |
|---|---|---|
| Double Salvo | Attack | Fire two regular shots this turn. |
| Chain Shot | Attack | Fire a shot. Every hit earns another shot, up to 3 in total. A miss ends the chain. |
| Flare Round | Attack | Fire one shot. The 8 cells around it light up, showing which hold a ship (you can then target them) and which are water. |
| Delayed Barrage | Attack | Target the 4 corners of a 3×3 area. Both players see the 4 cells. You still take your regular shot this turn; the barrage lands at the start of your next turn and is that turn's shot (you can still play a utility card). The enemy gets one turn to move or shield ships there. |
| Skipping Stone | Attack | Like the Torpedo, pick a row where you have a ship. It hits every other cell, starting at A (A, C, E, G, I) or B (B, D, F, H, J): click a cell to use its column's pattern, or click the row number and press R to switch. It doesn't stop on a hit and skims over mines. |
| Torpedo | Attack | Pick a row number on the enemy grid. You can only choose rows where one of your ships sits, so the enemy learns that row. The torpedo runs the whole row from left to right and strikes the first intact enemy segment (or a mine). |
| Cluster Bomb | Attack | Strike a plus-shaped area of up to 5 cells. |
| Rapid Fire | Attack | Choose 4 cells anywhere and fire at all of them. |
| Parallel Shots | Attack | Fire a straight 3×1 line, horizontal or vertical. |
| Sonar Ping | Utility | Learn how many intact (unscrambled) ship segments are in a 3×3 area. |
| Field Repair | Utility | Repair one damaged segment of a ship that's still afloat. **Single use.** |
| Full Maintenance | Utility | Fully repair one ship that's still afloat. **Single use.** |
| Move | Utility | Relocate a ship to a hidden position. Its damage moves with it, and the enemy's old markers on it disappear. It can't land on cells the enemy has already marked. **Single use.** |
| Call for Backup | Utility | Deploy an extra 2×1 Patrol Boat. It must also be sunk to win. **Single use.** |
| Rocket Shield | Utility | One ship ignores all attacks during the enemy's next turn. Blocked shots still reveal that a ship is there. |
| Scrambler | Utility | Enemy sonar can't detect this ship until it is sunk. |
| Recon Flight | Utility | Fly over a full row or column of enemy waters and learn whether any intact ship segment is there (yes/no). Unlike Sonar, Scrambler doesn't hide ships from it. |
| Decoy | Utility | Place a hidden 2×1 fake ship. Hits on it look real until it's destroyed and revealed. It doesn't count toward the win. |
| Mine Field | Utility | Lay a hidden vertical mine field (3 cells tall) on open water. Torpedoes run along rows, so it guards 3 rows. The first enemy torpedo to cross it explodes there, and the field is used up. Normal shots ignore mines. |
| Software Bug | Utility | On their next turn the enemy can't fire or play attack cards. They can still play a utility card, then end their turn. |
| Deploy the Seals | Utility | A random card from the enemy's hand is shuffled back into the deck. |
| Spy Satellite | Utility | See the enemy's hand and choose one card to shuffle back into the deck. |
| Salvage | Utility | Take any card of your choice from the discard pile. |
| Heavy Cargo | Utility | Dump it into the enemy's hand. It takes up one of their 4 slots (so they may skip draws) for their next 2 turns, then sinks. It can't be played, sent back, or taken by Seals/Spy Satellite. |
| Smoke Screen | Utility | The enemy fires blind for their next 2 turns: their shot results show as "?" and are revealed when the smoke lifts, at the start of their third turn. Sinking a ship is still announced. A second Smoke Screen resets the 2 turns rather than adding to them. |
| Follow the Trail | Utility | A trap that stays armed until the enemy next hits one of your real ships. Then one intact segment of a random enemy ship is revealed to you. |
| Care Package | Free, no limit | Shuffle another card from your hand back into the deck and draw a new one. |

**Shortcuts:** <kbd>1</kbd>–<kbd>4</kbd> pick a card, <kbd>R</kbd> or the mouse wheel (over the grid) rotates or switches orientation (deployment, Move, Backup, Decoy, Parallel Shots, Recon Flight, Skipping Stone start column), and <kbd>Esc</kbd> cancels.

## Project structure

```
index.html     Page layout
style.css      Styles
engine.js      Game rules: boards, damage, cards, deck (no DOM; also runs in Node)
ai.js          Computer opponent
ui.js          Rendering and input
tests/sim.js   AI-vs-AI simulation with rule invariant checks
```

To tweak balance, edit `CARDS`, `CARD_ORDER` and `DECK` (copies per card, starting hand, hand limit) at the top of `engine.js`.

## Tests

```bash
node tests/sim.js        # 400 games by default
node tests/sim.js 1000   # or choose how many
```

The simulation plays computer-vs-computer games and checks that:
- every game finishes;
- no card play is rejected;
- every card gets used;
- markers stay consistent with hidden damage, and sunk ships stay sunk;
- the deck plus discard pile plus both hands always total 46 cards.

It also prints the win split and game length as a quick balance check.

## Deployment

The site is fully static, so it can be served by GitHub Pages straight from the repository root. In the repo, go to **Settings → Pages**, choose **Deploy from a branch**, and select `main` and `/ (root)`.
