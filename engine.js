/*
 * Sonar & Salvo: game engine (no DOM).
 * Works in the browser (window.SonarSalvo) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  const SIZE = 10;

  const FLEET = [
    { id: 'carrier', name: 'Carrier', size: 5 },
    { id: 'battleship', name: 'Battleship', size: 4 },
    { id: 'cruiser', name: 'Cruiser', size: 3 },
    { id: 'submarine', name: 'Submarine', size: 3 },
    { id: 'destroyer', name: 'Destroyer', size: 2 },
  ];

  const BACKUP_SHIP = { id: 'patrol', name: 'Patrol Boat', size: 2 };
  const DECOY_SHIP = { id: 'decoy', name: 'Decoy', size: 2, decoy: true };
  const MINEFIELD_SIZE = 3;

  /*
   * kind:
   * A turn is: [one utility card] -> [one attack card] -> your regular shot (which ends the turn).
   *   attack  -> extra firepower; you still take your regular shot afterwards
   *   utility -> must be played before your attack card; one per turn
   *   free    -> doesn't count toward either limit
   *   locked  -> sits in your hand and can't be played (Heavy Cargo)
   */
  const CARDS = {
    sonar: {
      name: 'Sonar Ping', kind: 'utility', icon: '◎',
      desc: 'Scan a 3×3 area of enemy waters and learn how many intact ship segments hide there.',
    },
    repair: {
      name: 'Field Repair', kind: 'utility', icon: '⚒',
      desc: 'Patch one damaged segment of a ship that is still afloat. Single use: stays in the discard pile.',
    },
    maintenance: {
      name: 'Full Maintenance', kind: 'utility', icon: '✦',
      desc: 'Fully repair one of your ships that is still afloat. Single use: stays in the discard pile.',
    },
    move: {
      name: 'Move', kind: 'utility', icon: '⇄',
      desc: 'Relocate one of your ships to a new hidden position. Its damage moves with it.',
    },
    backup: {
      name: 'Call for Backup', kind: 'utility', icon: '⚓',
      desc: 'Deploy an extra 2×1 Patrol Boat anywhere in your waters. Single use: stays in the discard pile.',
    },
    shield: {
      name: 'Rocket Shield', kind: 'utility', icon: '◈',
      desc: 'One ship ignores all attacks during the enemy’s next turn. Blocked shots still reveal it.',
    },
    scrambler: {
      name: 'Scrambler', kind: 'utility', icon: '≋',
      desc: 'Enemy sonar can no longer detect one of your ships, until it is sunk.',
    },
    carepackage: {
      name: 'Care Package', kind: 'free', icon: '✉',
      desc: 'Shuffle another card from your hand back into the deck and draw a new one.',
    },
    double: {
      name: 'Double Salvo', kind: 'attack', icon: '⁑',
      desc: 'Take one extra regular shot this turn.',
    },
    torpedo: {
      name: 'Torpedo', kind: 'attack', icon: '➤',
      desc: 'Launch from one of your ships in any straight direction. It strikes the first intact enemy segment in its path.',
    },
    cluster: {
      name: 'Cluster Bomb', kind: 'attack', icon: '✚',
      desc: 'Strike a plus-shaped area of up to 5 cells.',
    },
    rapid: {
      name: 'Rapid Fire', kind: 'attack', icon: '⁂',
      desc: 'Choose 4 cells anywhere in enemy waters and fire at all of them.',
    },
    parallel: {
      name: 'Parallel Shots', kind: 'attack', icon: '☰',
      desc: 'Fire a straight 3×1 line of shots, horizontal or vertical.',
    },
    minefield: {
      name: 'Mine Field', kind: 'utility', icon: '⁜',
      desc: 'Lay a hidden 3×1 mine field on open water. The first enemy torpedo to cross it explodes there.',
    },
    seals: {
      name: 'Deploy the Seals', kind: 'utility', icon: '⚔',
      desc: 'A random card from the enemy’s hand is shuffled back into the deck.',
    },
    bug: {
      name: 'Software Bug', kind: 'utility', icon: '⌁',
      desc: 'Next turn the enemy cannot fire or play attack cards. Utility cards still work.',
    },
    decoy: {
      name: 'Decoy', kind: 'utility', icon: '◇',
      desc: 'Place a hidden 2×1 fake ship. Hits on it look real until it is destroyed and revealed.',
    },
    recon: {
      name: 'Recon Flight', kind: 'utility', icon: '✈',
      desc: 'Fly over a full row or column of enemy waters and learn whether any intact ship segment is there.',
    },
    salvage: {
      name: 'Salvage', kind: 'utility', icon: '♻',
      desc: 'Take any card of your choice from the discard pile.',
    },
    spy: {
      name: 'Spy Satellite', kind: 'utility', icon: '⌖',
      desc: 'See the enemy’s hand and pick one card to shuffle back into the deck.',
    },
    cargo: {
      name: 'Heavy Cargo', kind: 'utility', icon: '▣',
      desc: 'Dump this on the enemy. It blocks one of their hand slots for their next 2 turns, then sinks.',
    },
    smoke: {
      name: 'Smoke Screen', kind: 'utility', icon: '☁',
      desc: 'During the enemy’s next turn their shot results are hidden from them until their following turn.',
    },
    trail: {
      name: 'Follow the Trail', kind: 'utility', icon: '⌕',
      desc: 'Trap: the next time the enemy hits one of your ships, one segment of an enemy ship is revealed.',
    },
    // Not in the deck: what Heavy Cargo becomes once it lands in the enemy's hand.
    cargoload: {
      name: 'Heavy Cargo', kind: 'locked', icon: '▣',
      desc: 'Dead weight. Can’t be played or sent back. Sinks after your turn ends twice.',
    },
  };

  const CARD_ORDER = [
    'sonar', 'recon', 'double', 'torpedo', 'cluster', 'rapid', 'parallel',
    'repair', 'maintenance', 'move', 'backup', 'decoy', 'shield', 'scrambler', 'minefield',
    'bug', 'seals', 'spy', 'salvage', 'cargo', 'smoke', 'trail', 'carepackage',
  ];
  const CARGO_TURNS = 2;

  // Single-use cards: once played they stay in the discard pile for the rest of the game
  // (never reshuffled into the deck, can't be salvaged). Keeps games from dragging on.
  const SINGLE_USE = ['repair', 'maintenance', 'backup'];
  const isSalvageable = (k) => !SINGLE_USE.includes(k);

  const DECK = { copies: 2, startHand: 2, handMax: 4 };
  const DECK_SIZE = CARD_ORDER.length * DECK.copies;

  // What the attacker sees on a cell.
  // BLOCKED = a shield deflected a shot here; SPOTTED = Follow the Trail revealed a ship segment here.
  const SHOT = { NONE: 0, MISS: 1, HIT: 2, BLOCKED: 3, SPOTTED: 4 };

  const DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };

  const idx = (r, c) => r * SIZE + c;
  const inBounds = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  const clampCenter = (v) => Math.max(1, Math.min(SIZE - 2, v));

  function shipCells(size, r, c, horizontal) {
    const cells = [];
    for (let i = 0; i < size; i++) cells.push(horizontal ? [r, c + i] : [r + i, c]);
    return cells;
  }

  function shuffle(list, rng) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  /* ------------------------------------------------------------------ */
  /* Areas of effect (shared by engine, AI and UI previews)              */
  /* ------------------------------------------------------------------ */

  function sonarArea(r, c) {
    const cr = clampCenter(r), cc = clampCenter(c);
    const cells = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) cells.push([cr + dr, cc + dc]);
    return { r: cr, c: cc, cells };
  }

  function clusterArea(r, c) {
    return [[r, c], [r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([a, b]) => inBounds(a, b));
  }

  function parallelArea(r, c, horizontal) {
    const cells = horizontal ? [[r, c - 1], [r, c], [r, c + 1]] : [[r - 1, c], [r, c], [r + 1, c]];
    return cells.filter(([a, b]) => inBounds(a, b));
  }

  // A full row ('row') or column ('col').
  function lineCells(line, index) {
    const cells = [];
    for (let i = 0; i < SIZE; i++) cells.push(line === 'row' ? [index, i] : [i, index]);
    return cells;
  }

  // Cells a torpedo crosses, starting just past its launch cell.
  function torpedoPath(r, c, dir) {
    const d = DIRS[dir];
    const cells = [];
    if (!d) return cells;
    for (let a = r + d[0], b = c + d[1]; inBounds(a, b); a += d[0], b += d[1]) cells.push([a, b]);
    return cells;
  }

  // Direction from a launch cell toward another cell on the same row/column.
  function directionTo(fromR, fromC, toR, toC) {
    if (fromR === toR && toC !== fromC) return toC > fromC ? 'right' : 'left';
    if (fromC === toC && toR !== fromR) return toR > fromR ? 'down' : 'up';
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Board                                                               */
  /* ------------------------------------------------------------------ */

  function makeShip(def) {
    return {
      decoy: false,
      ...def,
      cells: [], placed: false, horizontal: true,
      damage: new Array(def.size).fill(false),
      scrambled: false, shieldedUntil: -1,
    };
  }

  class Board {
    constructor() {
      this.reset();
    }

    reset() {
      this.grid = new Array(SIZE * SIZE).fill(-1); // ship index or -1
      this.shots = new Array(SIZE * SIZE).fill(SHOT.NONE);
      this.ships = FLEET.map(makeShip);
      this.backups = 0;
      this.decoys = 0;
      this.mines = [];      // hidden mine fields: { cells: [[r, c]...], active }
      this.detonated = [];  // cells where a mine caught a torpedo (public)
      this.fog = new Set(); // cells whose result the attacker can't see yet (Smoke Screen)
    }

    mineAt(r, c) {
      return this.mines.findIndex((m) => m.active && m.cells.some(([a, b]) => a === r && b === c));
    }

    shipAt(r, c) { return this.grid[idx(r, c)]; }
    shotAt(r, c) { return this.shots[idx(r, c)]; }

    segment(r, c) {
      const s = this.grid[idx(r, c)];
      if (s === -1) return null;
      const i = this.ships[s].cells.findIndex(([a, b]) => a === r && b === c);
      return { ship: s, seg: i };
    }

    // Free water: no other ship, and nothing the opponent has marked there
    // (except markers on the ship's own current cells, which move away with it).
    cellsFree(cells, ignore = -1) {
      return cells.every(([r, c]) => {
        if (!inBounds(r, c)) return false;
        const occ = this.grid[idx(r, c)];
        if (occ !== -1 && occ !== ignore) return false;
        if (this.mineAt(r, c) !== -1) return false;
        return this.shots[idx(r, c)] === SHOT.NONE || (ignore !== -1 && occ === ignore);
      });
    }

    canPlace(i, r, c, horizontal) {
      return this.cellsFree(shipCells(this.ships[i].size, r, c, horizontal), i);
    }

    place(i, r, c, horizontal) {
      if (!this.canPlace(i, r, c, horizontal)) return false;
      this._lift(i);
      const ship = this.ships[i];
      ship.cells = shipCells(ship.size, r, c, horizontal);
      ship.horizontal = horizontal;
      ship.placed = true;
      ship.cells.forEach(([rr, cc]) => { this.grid[idx(rr, cc)] = i; });
      return true;
    }

    _lift(i) {
      const ship = this.ships[i];
      ship.cells.forEach(([r, c]) => { this.grid[idx(r, c)] = -1; });
      ship.cells = [];
      ship.placed = false;
    }

    remove(i) {
      this._lift(i);
      this.ships[i].damage.fill(false);
    }

    clearShips() {
      this.ships.forEach((_, i) => this.remove(i));
    }

    randomize(rng = Math.random) {
      for (let attempt = 0; attempt < 100; attempt++) {
        this.clearShips();
        let ok = true;
        for (let i = 0; i < this.ships.length && ok; i++) {
          const spot = this.randomSpot(this.ships[i].size, i, rng);
          ok = !!spot && this.place(i, spot.r, spot.c, spot.horizontal);
        }
        if (ok) return true;
      }
      return false;
    }

    // A random legal position for a ship of `size` (ignoring ship `ignore`'s own cells).
    randomSpot(size, ignore = -1, rng = Math.random) {
      const spots = [];
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) for (const h of [true, false]) {
        if (this.cellsFree(shipCells(size, r, c, h), ignore)) spots.push({ r, c, horizontal: h });
      }
      return spots.length ? spots[Math.floor(rng() * spots.length)] : null;
    }

    allPlaced() { return this.ships.every((s) => s.placed); }

    hitsOn(i) { return this.ships[i].damage.filter(Boolean).length; }

    isSunk(i) {
      const s = this.ships[i];
      return s.placed && s.damage.every(Boolean);
    }

    // Real ships still in the fight (decoys don't count).
    afloat() { return this.ships.map((_, i) => i).filter((i) => !this.ships[i].decoy && !this.isSunk(i)); }

    allSunk() { return this.ships.every((s, i) => s.decoy || this.isSunk(i)); }

    isShielded(i, turn) { return this.ships[i].shieldedUntil >= turn; }

    // Cells the attacker may still fire at.
    targetable(r, c) {
      if (!inBounds(r, c)) return false;
      if (this.fog.has(idx(r, c))) return false; // wait for the smoke to clear
      const s = this.shots[idx(r, c)];
      return s === SHOT.NONE || s === SHOT.BLOCKED || s === SHOT.SPOTTED;
    }

    receiveShot(r, c, turn = 0) {
      if (!this.targetable(r, c)) return { r, c, result: 'invalid' };
      const k = idx(r, c);
      const s = this.grid[k];
      if (s === -1) {
        this.shots[k] = SHOT.MISS;
        return { r, c, result: 'miss' };
      }
      const ship = this.ships[s];
      if (this.isShielded(s, turn)) {
        this.shots[k] = SHOT.BLOCKED;
        return { r, c, result: 'blocked', ship: s, shipName: ship.name };
      }
      const { seg } = this.segment(r, c);
      ship.damage[seg] = true;
      this.shots[k] = SHOT.HIT;
      if (this.isSunk(s)) {
        // A sunk ship is fully revealed (even through smoke), including segments damaged before a move.
        ship.cells.forEach(([a, b]) => { this.shots[idx(a, b)] = SHOT.HIT; this.fog.delete(idx(a, b)); });
        return { r, c, result: ship.decoy ? 'decoy' : 'sunk', ship: s, shipName: ship.name };
      }
      return { r, c, result: 'hit', ship: s, shipName: ship.name };
    }

    scan(r, c) {
      const area = sonarArea(r, c);
      let count = 0;
      area.cells.forEach(([rr, cc]) => {
        const at = this.segment(rr, cc);
        if (!at) return;
        const ship = this.ships[at.ship];
        if (!ship.scrambled && !ship.damage[at.seg]) count++;
      });
      return { r: area.r, c: area.c, count, cells: area.cells };
    }

    // Recon Flight: is any intact segment (decoys included, scramblers don't help) on this line?
    recon(line, index) {
      const cells = lineCells(line, index);
      const found = cells.some(([r, c]) => {
        const at = this.segment(r, c);
        return !!at && !this.ships[at.ship].damage[at.seg];
      });
      return { line, index, found, cells };
    }

    canRepair(r, c) {
      if (!inBounds(r, c)) return false;
      const at = this.segment(r, c);
      return !!at && !this.ships[at.ship].decoy && !this.isSunk(at.ship) && this.ships[at.ship].damage[at.seg];
    }

    repair(r, c) {
      if (!this.canRepair(r, c)) return false;
      const at = this.segment(r, c);
      this.ships[at.ship].damage[at.seg] = false;
      if (this.shots[idx(r, c)] === SHOT.HIT) this.shots[idx(r, c)] = SHOT.NONE;
      return true;
    }

    repairableCells() {
      const out = [];
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (this.canRepair(r, c)) out.push([r, c]);
      return out;
    }

    canMaintain(i) { return !!this.ships[i] && !this.ships[i].decoy && !this.isSunk(i) && this.hitsOn(i) > 0; }

    maintain(i) {
      if (!this.canMaintain(i)) return false;
      const ship = this.ships[i];
      ship.cells.forEach(([r, c], seg) => {
        if (ship.damage[seg] && this.shots[idx(r, c)] === SHOT.HIT) this.shots[idx(r, c)] = SHOT.NONE;
      });
      ship.damage.fill(false);
      return true;
    }

    canMove(i, r, c, horizontal) {
      return !!this.ships[i] && !this.ships[i].decoy && !this.isSunk(i) && this.canPlace(i, r, c, horizontal);
    }

    // Move a ship; its damage travels with it and old markers are wiped.
    move(i, r, c, horizontal) {
      if (!this.canMove(i, r, c, horizontal)) return false;
      this.ships[i].cells.forEach(([a, b]) => { this.shots[idx(a, b)] = SHOT.NONE; });
      return this.place(i, r, c, horizontal);
    }

    canAddShip(r, c, horizontal) {
      return this.cellsFree(shipCells(BACKUP_SHIP.size, r, c, horizontal));
    }

    // Adds a Patrol Boat (backup) or a Decoy.
    addShip(r, c, horizontal, def = BACKUP_SHIP) {
      if (!this.canAddShip(r, c, horizontal)) return -1;
      const n = def.decoy ? ++this.decoys : ++this.backups;
      const ship = makeShip({ ...def, id: `${def.id}-${n}`, name: n > 1 ? `${def.name} ${n}` : def.name });
      this.ships.push(ship);
      const i = this.ships.length - 1;
      this.place(i, r, c, horizontal);
      return i;
    }

    // Mines go on open, unmarked water only.
    canPlaceMines(r, c, horizontal) {
      return this.cellsFree(shipCells(MINEFIELD_SIZE, r, c, horizontal));
    }

    placeMines(r, c, horizontal) {
      if (!this.canPlaceMines(r, c, horizontal)) return false;
      this.mines.push({ cells: shipCells(MINEFIELD_SIZE, r, c, horizontal), active: true });
      return true;
    }

    detonate(fieldIndex, r, c) {
      this.mines[fieldIndex].active = false;
      this.detonated.push([r, c]);
      if (this.shots[idx(r, c)] === SHOT.NONE) this.shots[idx(r, c)] = SHOT.MISS;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Game                                                                */
  /* ------------------------------------------------------------------ */

  class Game {
    constructor(rng = Math.random) {
      this.rng = rng;
      this.boards = [new Board(), new Board()]; // 0 = human, 1 = computer
      this.phase = 'setup'; // setup | battle | over
      this.turn = 0;
      this.turnNumber = 0;
      this.winner = null;
      this.shotsLeft = 0;
      this.deck = shuffle(CARD_ORDER.flatMap((k) => new Array(DECK.copies).fill(k)), rng);
      this.discard = [];
      this.hands = [[], []];
      this.scans = [[], []];         // sonar pings player p made on the opponent's board
      this.recons = [[], []];        // recon flights player p made: { line, index, found, turn }
      this.bugNext = [false, false]; // player p loses their shot next turn (Software Bug)
      this.jammed = false;           // current player is bugged this turn
      this.smokeNext = [false, false]; // player p's next turn is fought blind (Smoke Screen)
      this.smoked = false;           // current player's results are hidden this turn
      this.trail = [false, false];   // player p has Follow the Trail armed
      this.cargo = [[], []];         // turns left for each Heavy Cargo in player p's hand
      this.utilityPlayed = false;
      this.attackPlayed = false;
      this.moves = [0, 0];           // public: how many times player p relocated a ship
      this.shieldTurn = [-1, -1];    // public: last turn player p raised a shield
      this.stats = [0, 1].map(() => ({ shots: 0, hits: 0, cards: 0, sunk: 0 }));
      this.openingEvents = [];
    }

    start(first = 0) {
      this.phase = 'battle';
      this.turn = first;
      const events = [];
      for (let n = 0; n < DECK.startHand; n++) [first, 1 - first].forEach((p) => this.draw(p, events, 'start'));
      this._beginTurn(events);
      this.openingEvents = events;
      return events;
    }

    draw(p, events, reason) {
      if (this.hands[p].length >= DECK.handMax) {
        events.push({ type: 'draw', player: p, skipped: true, reason });
        return;
      }
      if (!this.deck.length && this.discard.some(isSalvageable)) {
        this.deck = shuffle(this.discard.filter(isSalvageable), this.rng);
        this.discard = this.discard.filter((k) => !isSalvageable(k)); // single-use cards stay out
        events.push({ type: 'reshuffle' });
      }
      const card = this.deck.pop();
      if (!card) return;
      this.hands[p].push(card);
      events.push({ type: 'draw', player: p, card, reason });
    }

    _beginTurn(events) {
      this.turnNumber++;
      this.shotsLeft = 1;
      this.utilityPlayed = false;
      this.attackPlayed = false;
      this.jammed = this.bugNext[this.turn];
      this.bugNext[this.turn] = false;
      // Smoke from the previous turn lifts: show this player what they hit.
      const fogged = this.boards[1 - this.turn].fog;
      if (fogged.size) {
        events.push({ type: 'smoke-clear', player: this.turn, cells: [...fogged].map((k) => [Math.floor(k / SIZE), k % SIZE]) });
        fogged.clear();
      }
      this.smoked = this.smokeNext[this.turn];
      this.smokeNext[this.turn] = false;
      this.draw(this.turn, events, 'turn');
      if (this.jammed) events.push({ type: 'jammed', player: this.turn });
      if (this.smoked) events.push({ type: 'smoked', player: this.turn });
    }

    // Only a bugged player ends their turn without firing.
    endTurn(p) {
      if (this.phase !== 'battle' || this.turn !== p) return { ok: false, reason: 'Not your turn' };
      if (!this.jammed) return { ok: false, reason: 'You still have a shot to fire' };
      const events = [{ type: 'pass', player: p }];
      this._endTurn(events);
      return { ok: true, events };
    }

    _endTurn(events) {
      // Heavy Cargo in the current player's hand gets closer to sinking.
      const p = this.turn;
      this.cargo[p] = this.cargo[p].map((n) => n - 1);
      while (this.cargo[p].length && this.cargo[p][0] <= 0) {
        this.cargo[p].shift();
        this.hands[p].splice(this.hands[p].indexOf('cargoload'), 1);
        this.discard.push('cargo');
        events.push({ type: 'cargo-sink', player: p });
      }
      this.turn = 1 - this.turn;
      events.push({ type: 'turn', player: this.turn });
      this._beginTurn(events);
    }

    /* ---- validation --------------------------------------------------- */

    cardBlocker(p, key) {
      const card = CARDS[key];
      if (!card) return 'Unknown card';
      if (this.phase !== 'battle') return 'The battle is not on';
      if (this.turn !== p) return 'Not your turn';
      if (this.shotsLeft < 1) return 'No shots left';
      if (card.kind === 'locked') return 'Heavy Cargo can’t be played';
      if (card.kind === 'utility' && this.utilityPlayed) return 'One utility card per turn';
      if (card.kind === 'utility' && this.attackPlayed) return 'Utility cards must come before your attack card';
      if (card.kind === 'attack' && this.attackPlayed) return 'One attack card per turn';
      if (card.kind === 'attack' && this.jammed) return 'Software Bug: no attacks this turn';
      const own = this.boards[p];
      switch (key) {
        case 'minefield': return own.randomSpot(MINEFIELD_SIZE) ? null : 'No open water left';
        case 'decoy': return own.randomSpot(DECOY_SHIP.size) ? null : 'No room for a decoy';
        case 'seals':
        case 'spy': return this.hands[1 - p].some((k) => k !== 'cargoload') ? null : 'The enemy has no cards to take';
        case 'cargo': return this.hands[1 - p].length < DECK.handMax ? null : 'The enemy’s hand is already full';
        case 'trail': return this.trail[p] ? 'Follow the Trail is already armed' : null;
        case 'salvage': return this.discard.some(isSalvageable) ? null : 'Nothing in the discard pile can be salvaged';
        case 'repair': return own.repairableCells().length ? null : 'Nothing to repair';
        case 'maintenance': return own.ships.some((_, i) => own.canMaintain(i)) ? null : 'No damaged ships';
        case 'scrambler': return own.afloat().some((i) => !own.ships[i].scrambled) ? null : 'All ships already scrambled';
        case 'backup': return own.randomSpot(BACKUP_SHIP.size) ? null : 'No room for a boat';
        case 'carepackage': return this.hands[p].filter((k) => k !== 'cargoload').length >= 2 ? null : 'No other card to send back';
        default: return null;
      }
    }

    canPlay(p, key) { return this.cardBlocker(p, key) === null; }

    /* ---- actions ------------------------------------------------------ */

    _strike(p, r, c) {
      const opp = this.boards[1 - p];
      const res = opp.receiveShot(r, c, this.turnNumber);
      if (this.smoked && res.result !== 'invalid' && res.result !== 'sunk') opp.fog.add(idx(r, c));
      return res;
    }

    // Follow the Trail: a real hit on the trap-setter's ship reveals one of the attacker's segments.
    _springTrail(p, results, events) {
      const owner = 1 - p;
      if (!this.trail[owner]) return;
      const victim = this.boards[owner];
      if (!results.some((r) => (r.result === 'hit' || r.result === 'sunk') && !victim.ships[r.ship].decoy)) return;
      const attacker = this.boards[p];
      const options = [];
      attacker.afloat().forEach((i) => attacker.ships[i].cells.forEach(([r, c], seg) => {
        if (!attacker.ships[i].damage[seg] && attacker.shotAt(r, c) === SHOT.NONE) options.push([r, c]);
      }));
      if (!options.length) return;
      this.trail[owner] = false;
      const [r, c] = options[Math.floor(this.rng() * options.length)];
      attacker.shots[idx(r, c)] = SHOT.SPOTTED;
      events.push({ type: 'trail', player: owner, r, c });
    }

    _resolveStrikes(p, results, events) {
      this._springTrail(p, results, events);
      results.forEach((res) => {
        this.stats[p].shots++;
        if (res.result === 'hit' || res.result === 'sunk') this.stats[p].hits++;
        if (res.result === 'sunk') {
          this.stats[p].sunk++;
          this.draw(1 - p, events, 'sunk'); // the player who lost a ship draws a card
        }
      });
      if (this.boards[1 - p].allSunk()) {
        this.phase = 'over';
        this.winner = p;
        events.push({ type: 'win', player: p });
        return;
      }
      if (this.shotsLeft <= 0) this._endTurn(events);
    }

    fire(p, r, c) {
      if (this.phase !== 'battle' || this.turn !== p || this.shotsLeft < 1) return { ok: false, reason: 'Cannot fire now' };
      if (this.jammed) return { ok: false, reason: 'Software Bug: your guns are offline this turn' };
      const res = this._strike(p, r, c);
      if (res.result === 'invalid') return { ok: false, reason: 'Already targeted' };
      this.shotsLeft--;
      const events = [{ type: 'shot', player: p, results: [res], smoked: this.smoked }];
      this._resolveStrikes(p, [res], events);
      return { ok: true, events };
    }

    playCard(p, handIndex, target = {}) {
      const hand = this.hands[p];
      const key = hand[handIndex];
      if (!key) return { ok: false, reason: 'No such card' };
      const blocker = this.cardBlocker(p, key);
      if (blocker) return { ok: false, reason: blocker };

      const own = this.boards[p];
      const opp = this.boards[1 - p];
      const fail = (reason) => ({ ok: false, reason });
      const events = [];
      let strikes = null;
      const ev = { type: 'card', card: key, player: p };

      switch (key) {
        case 'sonar': {
          if (!inBounds(target.r, target.c)) return fail('Pick a cell in enemy waters');
          const scan = opp.scan(target.r, target.c);
          this.scans[p].push({ r: scan.r, c: scan.c, count: scan.count, turn: this.turnNumber });
          Object.assign(ev, { r: scan.r, c: scan.c, count: scan.count });
          break;
        }
        case 'repair': {
          const at = inBounds(target.r, target.c) && own.segment(target.r, target.c);
          if (!own.repair(target.r, target.c)) return fail('Pick a damaged segment of a ship still afloat');
          Object.assign(ev, { r: target.r, c: target.c, shipName: own.ships[at.ship].name });
          break;
        }
        case 'maintenance': {
          if (!own.maintain(target.ship)) return fail('Pick a damaged ship that is still afloat');
          Object.assign(ev, { ship: target.ship, shipName: own.ships[target.ship].name });
          break;
        }
        case 'move': {
          const h = !!target.horizontal;
          if (!own.move(target.ship, target.r, target.c, h)) return fail('That ship cannot move there');
          this.moves[p]++;
          Object.assign(ev, { ship: target.ship, shipName: own.ships[target.ship].name });
          break;
        }
        case 'backup': {
          const i = own.addShip(target.r, target.c, !!target.horizontal);
          if (i < 0) return fail('The boat does not fit there');
          Object.assign(ev, { ship: i, shipName: own.ships[i].name });
          break;
        }
        case 'shield': {
          const i = target.ship;
          if (!own.ships[i] || own.ships[i].decoy || own.isSunk(i)) return fail('Pick a ship that is still afloat');
          own.ships[i].shieldedUntil = this.turnNumber + 1;
          this.shieldTurn[p] = this.turnNumber;
          Object.assign(ev, { ship: i, shipName: own.ships[i].name });
          break;
        }
        case 'scrambler': {
          const i = target.ship;
          if (!own.ships[i] || own.ships[i].decoy || own.isSunk(i) || own.ships[i].scrambled) return fail('Pick an afloat ship that is not scrambled yet');
          own.ships[i].scrambled = true;
          Object.assign(ev, { ship: i, shipName: own.ships[i].name });
          break;
        }
        case 'carepackage': {
          const ri = target.returnIndex;
          if (ri === handIndex || !hand[ri] || hand[ri] === 'cargoload') return fail('Pick another card to send back');
          const returned = hand[ri];
          // Remove both cards (higher index first so indices stay valid).
          [handIndex, ri].sort((a, b) => b - a).forEach((i) => hand.splice(i, 1));
          this.discard.push(key);
          this.deck.push(returned);
          shuffle(this.deck, this.rng);
          this.stats[p].cards++;
          ev.returned = returned;
          events.push(ev);
          this.draw(p, events, 'carepackage');
          return { ok: true, events };
        }
        case 'double': {
          this.shotsLeft++;
          break;
        }
        case 'cargo': {
          if (this.hands[1 - p].length >= DECK.handMax) return fail('The enemy’s hand is already full');
          hand.splice(handIndex, 1);
          this.hands[1 - p].push('cargoload');
          this.cargo[1 - p].push(CARGO_TURNS);
          this.utilityPlayed = true;
          this.stats[p].cards++;
          events.push(ev);
          return { ok: true, events };
        }
        case 'smoke': {
          this.smokeNext[1 - p] = true;
          break;
        }
        case 'trail': {
          this.trail[p] = true;
          break;
        }
        case 'minefield': {
          if (!own.placeMines(target.r, target.c, !!target.horizontal)) return fail('Mines need 3 cells of open, unmarked water');
          break;
        }
        case 'decoy': {
          const i = own.addShip(target.r, target.c, !!target.horizontal, DECOY_SHIP);
          if (i < 0) return fail('The decoy does not fit there');
          Object.assign(ev, { ship: i, shipName: own.ships[i].name });
          break;
        }
        case 'bug': {
          this.bugNext[1 - p] = true;
          break;
        }
        case 'recon': {
          const line = target.line === 'col' ? 'col' : 'row';
          if (!(target.index >= 0 && target.index < SIZE)) return fail('Pick a row or column in enemy waters');
          const rec = opp.recon(line, target.index);
          this.recons[p].push({ line, index: target.index, found: rec.found, turn: this.turnNumber });
          Object.assign(ev, { line, index: target.index, found: rec.found });
          break;
        }
        case 'seals':
        case 'spy': {
          const enemyHand = this.hands[1 - p];
          const takeable = enemyHand.map((k, j) => j).filter((j) => enemyHand[j] !== 'cargoload');
          const i = key === 'seals' ? takeable[Math.floor(this.rng() * takeable.length)] : target.index;
          if (!enemyHand[i] || enemyHand[i] === 'cargoload') return fail('Pick one of the enemy’s cards');
          const [removed] = enemyHand.splice(i, 1);
          this.deck.push(removed);
          shuffle(this.deck, this.rng);
          ev.removed = removed;
          break;
        }
        case 'salvage': {
          const i = isSalvageable(target.card) ? this.discard.indexOf(target.card) : -1;
          if (i < 0) return fail('Pick a card from the discard pile');
          this.discard.splice(i, 1);
          hand.push(target.card); // handIndex stays valid: the new card goes on the end
          ev.taken = target.card;
          break;
        }
        case 'torpedo': {
          const at = inBounds(target.r, target.c) && own.segment(target.r, target.c);
          if (!at || own.ships[at.ship].decoy || own.isSunk(at.ship)) return fail('Launch from a ship that is still afloat');
          const path = torpedoPath(target.r, target.c, target.dir);
          if (!path.some(([a, b]) => opp.targetable(a, b))) return fail('Nothing left to hit in that direction');
          strikes = [];
          for (const [a, b] of path) {
            const field = opp.mineAt(a, b);
            if (field !== -1) {
              opp.detonate(field, a, b);
              strikes.push({ r: a, c: b, result: 'mine' });
              break;
            }
            if (!opp.targetable(a, b)) continue; // glides past charted water and wrecks
            const res = this._strike(p, a, b);
            strikes.push(res);
            if (res.result !== 'miss') break;
          }
          Object.assign(ev, { r: target.r, c: target.c, dir: target.dir, shipName: own.ships[at.ship].name });
          break;
        }
        case 'cluster': {
          const cells = inBounds(target.r, target.c) ? clusterArea(target.r, target.c).filter(([a, b]) => opp.targetable(a, b)) : [];
          if (!cells.length) return fail('Nothing left to hit there');
          strikes = cells.map(([a, b]) => this._strike(p, a, b));
          Object.assign(ev, { r: target.r, c: target.c });
          break;
        }
        case 'parallel': {
          const cells = inBounds(target.r, target.c) ? parallelArea(target.r, target.c, !!target.horizontal).filter(([a, b]) => opp.targetable(a, b)) : [];
          if (!cells.length) return fail('Nothing left to hit there');
          strikes = cells.map(([a, b]) => this._strike(p, a, b));
          Object.assign(ev, { r: target.r, c: target.c, horizontal: !!target.horizontal });
          break;
        }
        case 'rapid': {
          const picks = Array.isArray(target.cells) ? target.cells : [];
          const unique = new Set(picks.map(([a, b]) => idx(a, b)));
          let open = 0;
          for (let a = 0; a < SIZE; a++) for (let b = 0; b < SIZE; b++) if (opp.targetable(a, b)) open++;
          const need = Math.min(4, open);
          if (unique.size !== picks.length || picks.length !== need || !picks.every(([a, b]) => opp.targetable(a, b))) {
            return fail(`Pick ${need} different open cells`);
          }
          strikes = picks.map(([a, b]) => this._strike(p, a, b));
          break;
        }
        default:
          return fail('Unknown card');
      }

      hand.splice(handIndex, 1);
      this.discard.push(key);
      if (CARDS[key].kind === 'attack') this.attackPlayed = true;
      else this.utilityPlayed = true;
      this.stats[p].cards++;
      if (strikes) { ev.results = strikes; ev.smoked = this.smoked; }
      events.push(ev);

      // Attack cards don't use up the regular shot: it still follows and ends the turn.
      if (strikes) this._resolveStrikes(p, strikes, events);
      return { ok: true, events };
    }

    cardCount() {
      return this.deck.length + this.discard.length + this.hands[0].length + this.hands[1].length; // Heavy Cargo in a hand counts as its card
    }
  }

  const api = {
    SIZE, FLEET, BACKUP_SHIP, DECOY_SHIP, MINEFIELD_SIZE, CARGO_TURNS, SINGLE_USE, CARDS, CARD_ORDER, DECK, DECK_SIZE, SHOT, DIRS,
    Board, Game,
    sonarArea, clusterArea, parallelArea, torpedoPath, lineCells, directionTo, shipCells, idx, inBounds,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SonarSalvo = api;
})(typeof window !== 'undefined' ? window : globalThis);
