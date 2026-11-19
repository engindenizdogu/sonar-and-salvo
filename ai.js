/*
 * Sonar & Salvo: computer opponent.
 * Only reads public information about the opponent's board: shot markers,
 * which ships are sunk, sonar results it made, and announced card plays.
 */
(function (root) {
  'use strict';

  const S = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.SonarSalvo;
  const { SIZE, SHOT, MINEFIELD_SIZE, idx, inBounds, sonarArea, clusterArea, parallelArea, lineCells, shipCells, barrageArea, stoneCells, ringArea } = S;

  // Most useful cards first: what to steal back with Salvage, or strip from the enemy with Spy Satellite.
  const CARD_VALUE = ['maintenance', 'rapid', 'cluster', 'chain', 'barrage', 'move', 'flare', 'stone', 'bug', 'torpedo', 'shield', 'parallel', 'smoke',
    'spy', 'double', 'repair', 'cargo', 'decoy', 'backup', 'trail', 'seals', 'recon', 'minefield', 'sonar', 'scrambler',
    'salvage', 'carepackage'];
  const valueOf = (k) => (CARD_VALUE.includes(k) ? CARD_VALUE.length - CARD_VALUE.indexOf(k) : -1);
  const FOG = -1; // a cell we fired at through smoke: result unknown to us

  const SONAR_EMPTY_PENALTY = 0.15; // scrambled ships make "0" readings unreliable

  class AI {
    constructor(game, p = 1, rng = Math.random) {
      this.game = game;
      this.p = p;
      this.rng = rng;
      this.penalty = new Map(); // cell -> multiplier from sonar readings
      this.scansSeen = 0;
      this.reconsSeen = 0;
      this.movesSeen = 0;
    }

    get target() { return this.game.boards[1 - this.p]; }
    get own() { return this.game.boards[this.p]; }

    /* ---- knowledge ---------------------------------------------------- */

    _refreshMemory() {
      const g = this.game;
      if (g.moves[1 - this.p] !== this.movesSeen) {
        // A ship moved: everything sonar told us may be stale.
        this.movesSeen = g.moves[1 - this.p];
        this.penalty.clear();
      }
      const scans = g.scans[this.p];
      const b = this.target;
      for (; this.scansSeen < scans.length; this.scansSeen++) {
        const s = scans[this.scansSeen];
        sonarArea(s.r, s.c).cells.forEach(([r, c]) => {
          if (b.shotAt(r, c) !== SHOT.NONE) return;
          const k = idx(r, c);
          const m = s.count === 0 ? SONAR_EMPTY_PENALTY : 1 + s.count;
          this.penalty.set(k, (this.penalty.get(k) || 1) * m);
        });
      }
      const recons = g.recons[this.p];
      for (; this.reconsSeen < recons.length; this.reconsSeen++) {
        const rc = recons[this.reconsSeen];
        lineCells(rc.line, rc.index).forEach(([r, c]) => {
          if (b.shotAt(r, c) !== SHOT.NONE) return;
          const k = idx(r, c);
          this.penalty.set(k, (this.penalty.get(k) || 1) * (rc.found ? 1.3 : 0.05));
        });
      }
    }

    // What we are allowed to know about a target cell.
    _seen(k) {
      return this.target.fog.has(k) ? FOG : this.target.shots[k];
    }

    // A marked ship cell whose ship is still afloat (hit, shield-revealed or spotted).
    _openMark(k) {
      const b = this.target;
      const st = this._seen(k);
      return (st === SHOT.HIT || st === SHOT.BLOCKED || st === SHOT.SPOTTED) && !b.isSunk(b.grid[k]);
    }

    hasOpenMarks() {
      for (let k = 0; k < SIZE * SIZE; k++) if (this._openMark(k)) return true;
      return false;
    }

    _shieldActive() {
      // Shields protect through the turn after they were raised.
      return this.game.turnNumber <= this.game.shieldTurn[1 - this.p] + 1;
    }

    density() {
      this._refreshMemory();
      const b = this.target;
      const score = new Float64Array(SIZE * SIZE);
      const sizes = b.ships.filter((s, i) => !s.decoy && !b.isSunk(i)).map((s) => s.size); // the decoy is not public
      for (const size of sizes) {
        for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) for (const h of [true, false]) {
          let valid = true, marks = 0;
          const cells = [];
          for (let n = 0; n < size; n++) {
            const a = h ? r : r + n, bb = h ? c + n : c;
            if (!inBounds(a, bb)) { valid = false; break; }
            const k = idx(a, bb);
            const st = this._seen(k);
            if (st === SHOT.MISS || (st === SHOT.HIT && !this._openMark(k))) { valid = false; break; }
            if (st !== SHOT.NONE && st !== FOG) marks++;
            cells.push(k);
          }
          if (!valid) continue;
          const w = marks ? Math.pow(30, marks) : 1;
          for (const k of cells) if (b.targetable(Math.floor(k / SIZE), k % SIZE)) score[k] += w;
        }
      }
      const shielded = this._shieldActive();
      for (let k = 0; k < SIZE * SIZE; k++) {
        if (this.penalty.has(k)) score[k] *= this.penalty.get(k);
        const st = this._seen(k);
        if (st === SHOT.BLOCKED) score[k] = shielded ? score[k] * 0.001 : score[k] * 50 + 1e6;
        if (st === SHOT.SPOTTED) score[k] = score[k] * 50 + 1e6;
      }
      return score;
    }

    /* ---- target pickers ----------------------------------------------- */

    _argmax(cands) {
      let best = -Infinity, pool = [];
      for (const cand of cands) {
        if (cand.value > best * (1 + 1e-9) + 1e-12) { best = cand.value; pool = [cand]; }
        else if (Math.abs(cand.value - best) <= Math.abs(best) * 1e-9 + 1e-12) pool.push(cand);
      }
      return pool.length ? pool[Math.floor(this.rng() * pool.length)] : null;
    }

    _sum(cells, score) {
      const b = this.target;
      let v = 0, n = 0;
      for (const [a, bb] of cells) if (b.targetable(a, bb)) { v += score[idx(a, bb)]; n++; }
      return n ? v : -1;
    }

    bestCell(score) {
      const b = this.target;
      const cands = [];
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
        if (b.targetable(r, c)) cands.push({ r, c, value: score[idx(r, c)] });
      }
      return this._argmax(cands);
    }

    _bestCluster(score) {
      const cands = [];
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
        const v = this._sum(clusterArea(r, c), score);
        if (v > 0) cands.push({ r, c, value: v });
      }
      return this._argmax(cands);
    }

    _bestLine3(score) {
      const cands = [];
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) for (const h of [true, false]) {
        const v = this._sum(parallelArea(r, c, h), score);
        if (v > 0) cands.push({ r, c, horizontal: h, value: v });
      }
      return this._argmax(cands);
    }

    _bestRapid4(score) {
      const b = this.target;
      const cells = [];
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
        if (b.targetable(r, c)) cells.push({ r, c, v: score[idx(r, c)] + this.rng() * 1e-6 });
      }
      cells.sort((x, y) => y.v - x.v);
      return cells.slice(0, 4).map(({ r, c }) => [r, c]);
    }

    _bestSonar(score) {
      const b = this.target;
      const cands = [];
      for (let r = 1; r < SIZE - 1; r++) for (let c = 1; c < SIZE - 1; c++) {
        const fresh = sonarArea(r, c).cells.filter(([a, bb]) => b.shotAt(a, bb) === SHOT.NONE && !this.penalty.has(idx(a, bb)));
        if (fresh.length < 6) continue;
        cands.push({ r, c, value: fresh.reduce((sum, [a, bb]) => sum + score[idx(a, bb)], 0) });
      }
      return this._argmax(cands);
    }

    _bestRecon(score) {
      const b = this.target;
      const cands = [];
      for (const line of ['row', 'col']) for (let i = 0; i < SIZE; i++) {
        const fresh = lineCells(line, i).filter(([r, c]) => b.shotAt(r, c) === SHOT.NONE && !this.penalty.has(idx(r, c)));
        if (fresh.length < 6) continue;
        cands.push({ line, index: i, value: fresh.reduce((sum, [r, c]) => sum + score[idx(r, c)], 0) });
      }
      return this._argmax(cands);
    }

    // Lay mines on open water next to our ships, where enemy torpedoes will pass.
    _bestMinefield() {
      const own = this.own;
      const cands = [];
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
        if (!own.canPlaceMines(r, c)) continue; // always vertical
        let near = 0;
        shipCells(MINEFIELD_SIZE, r, c, false).forEach(([a, bb]) => {
          [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dr, dc]) => {
            const s = inBounds(a + dr, bb + dc) ? own.shipAt(a + dr, bb + dc) : -1;
            if (s !== -1 && !own.ships[s].decoy && !own.isSunk(s)) near++;
          });
        });
        cands.push({ r, c, value: near + this.rng() });
      }
      return this._argmax(cands);
    }

    _bestFlare(score) {
      const b = this.target;
      const cands = [];
      for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
        if (!b.targetable(r, c)) continue;
        // value = the shot itself + what the lit-up ring could tell us
        let v = score[idx(r, c)];
        ringArea(r, c).forEach(([a, bb]) => { if (b.shots[idx(a, bb)] === SHOT.NONE) v += score[idx(a, bb)] * 0.5; });
        cands.push({ r, c, value: v });
      }
      return this._argmax(cands);
    }

    _bestBarrage(score) {
      const cands = [];
      for (let r = 1; r < SIZE - 1; r++) for (let c = 1; c < SIZE - 1; c++) {
        const v = this._sum(barrageArea(r, c).cells, score);
        if (v > 0) cands.push({ r, c, value: v });
      }
      return this._argmax(cands);
    }

    _bestStone(score) {
      const cands = [];
      for (const row of this.game.torpedoRows(this.p)) for (const offset of [0, 1]) {
        const v = this._sum(stoneCells(row, offset), score);
        if (v > 0) cands.push({ row, offset, value: v });
      }
      return this._argmax(cands);
    }

    // Our real ship (afloat) sitting under the enemy's announced Delayed Barrage, if any.
    _underBarrage() {
      const bar = this.game.barrage[1 - this.p];
      if (!bar) return undefined;
      const own = this.own;
      return own.afloat().find((i) => own.ships[i].cells.some(([r, c]) => bar.cells.some(([a, b]) => a === r && b === c)));
    }

    _bestTorpedo(score) {
      const b = this.target;
      const cands = [];
      for (const row of this.game.torpedoRows(this.p)) {
        // Expected value: earlier cells matter more because the torpedo stops on contact.
        let v = 0, decay = 1, any = false;
        for (const [a, bb] of lineCells('row', row)) {
          if (!b.targetable(a, bb)) continue;
          any = true;
          v += score[idx(a, bb)] * decay;
          decay *= 0.8;
        }
        if (any) cands.push({ row, value: v });
      }
      return this._argmax(cands);
    }

    /* ---- defense helpers ---------------------------------------------- */

    _damagedShips() {
      const own = this.own;
      return own.afloat().filter((i) => own.hitsOn(i) > 0);
    }

    _critical() {
      const own = this.own;
      return this._damagedShips().find((i) => own.ships[i].size - own.hitsOn(i) === 1);
    }

    // Ship the opponent currently has hit markers on.
    _hunted() {
      const own = this.own;
      return this._damagedShips().find((i) => own.ships[i].cells.some(([r, c]) => own.shotAt(r, c) === SHOT.HIT));
    }

    _useless(key) {
      const own = this.own;
      if (key === 'repair' || key === 'maintenance') return this._damagedShips().length === 0;
      if (key === 'scrambler') return !own.afloat().some((i) => !own.ships[i].scrambled);
      return false;
    }

    /* ---- decision ------------------------------------------------------ */

    nextAction() {
      const g = this.game, p = this.p, own = this.own;
      const hand = g.hands[p];
      const score = this.density();
      const has = (key) => hand.indexOf(key);
      const playable = (key) => has(key) >= 0 && g.canPlay(p, key);
      const card = (key, target = {}) => ({ kind: 'card', card: key, handIndex: has(key), target });
      const chance = (x) => this.rng() < x;

      // Care Package swaps out a card that can't help right now.
      if (playable('carepackage')) {
        const ri = hand.findIndex((k, i) => i !== has('carepackage') && k !== 'cargoload' && this._useless(k));
        if (ri >= 0) return card('carepackage', { returnIndex: ri });
      }

      const enemyHand = g.hands[1 - p];

      // Utility cards first (playable() enforces one utility, before any attack), then one attack card.
      if (g.shotsLeft >= 1) {
        // Disruption: hit the enemy's hand or their next turn.
        if (playable('bug') && chance(0.6)) return card('bug');
        if (playable('spy') && chance(0.6)) {
          const index = enemyHand.reduce((best, k, i) => (valueOf(k) > (best < 0 ? -2 : valueOf(enemyHand[best])) ? i : best), -1);
          if (index >= 0) return card('spy', { index });
        }
        if (playable('cargo') && enemyHand.length >= 2 && chance(0.6)) return card('cargo');
        if (playable('smoke') && chance(0.4)) return card('smoke');
        if (playable('trail') && this._damagedShips().length < own.afloat().length && chance(0.4)) return card('trail');
        if (playable('seals') && enemyHand.length >= 2 && chance(0.5)) return card('seals');
        if (playable('salvage')) {
          const best = g.discard.filter((k) => !S.SINGLE_USE.includes(k)).sort((x, y) => valueOf(y) - valueOf(x))[0];
          if (best && valueOf(best) >= valueOf('torpedo') && chance(0.7)) return card('salvage', { card: best });
        }

        // Defense first: get out from under an announced Delayed Barrage.
        const target = this._underBarrage();
        if (target !== undefined) {
          const bar = g.barrage[1 - p];
          if (playable('move')) {
            for (let tries = 0; tries < 20; tries++) {
              const spot = own.randomSpot(own.ships[target].size, target, this.rng);
              if (!spot) break;
              const cells = shipCells(own.ships[target].size, spot.r, spot.c, spot.horizontal);
              if (!cells.some(([r, c]) => bar.cells.some(([a, b]) => a === r && b === c))) return card('move', { ship: target, ...spot });
            }
          }
          if (playable('shield')) return card('shield', { ship: target });
        }
        const crit = this._critical();
        if (crit !== undefined) {
          if (playable('maintenance')) return card('maintenance', { ship: crit });
          if (playable('repair')) {
            const ship = own.ships[crit];
            const seg = ship.damage.findIndex(Boolean);
            const [r, c] = ship.cells[seg];
            return card('repair', { r, c });
          }
        }
        const hunted = this._hunted();
        if (hunted !== undefined) {
          if (playable('move') && chance(0.7)) {
            const spot = own.randomSpot(own.ships[hunted].size, hunted, this.rng);
            if (spot) return card('move', { ship: hunted, ...spot });
          }
          if (playable('shield') && chance(0.6)) return card('shield', { ship: hunted });
          if (playable('maintenance') && own.hitsOn(hunted) >= 2) return card('maintenance', { ship: hunted });
        }

        // Fleet utilities.
        if (playable('scrambler') && chance(0.5)) {
          const pick = own.afloat().filter((i) => !own.ships[i].scrambled).sort((a, b) => own.ships[b].size - own.ships[a].size)[0];
          if (pick !== undefined) return card('scrambler', { ship: pick });
        }
        if (playable('backup') && chance(0.5)) {
          const spot = own.randomSpot(2, -1, this.rng);
          if (spot) return card('backup', spot);
        }
        if (playable('decoy') && chance(0.4)) {
          const spot = own.randomSpot(2, -1, this.rng);
          if (spot) return card('decoy', spot);
        }
        if (playable('minefield') && chance(0.4)) {
          const t = this._bestMinefield();
          if (t) return card('minefield', t);
        }

        // Offense.
        // Delayed Barrage doesn't cost the shot, so it's almost always worth laying.
        if (playable('barrage') && chance(0.8)) { const t = this._bestBarrage(score); if (t) return card('barrage', t); }
        if (this.hasOpenMarks()) {
          if (playable('chain')) return card('chain');
          if (playable('parallel')) { const t = this._bestLine3(score); if (t) return card('parallel', t); }
          if (playable('rapid')) return card('rapid', { cells: this._bestRapid4(score) });
          if (playable('double')) return card('double');
          if (playable('cluster')) { const t = this._bestCluster(score); if (t) return card('cluster', t); }
          if (playable('torpedo') && chance(0.5)) { const t = this._bestTorpedo(score); if (t) return card('torpedo', t); }
        } else {
          if (playable('cluster') && chance(0.7)) { const t = this._bestCluster(score); if (t) return card('cluster', t); }
          if (playable('rapid') && chance(0.7)) return card('rapid', { cells: this._bestRapid4(score) });
          if (playable('torpedo') && chance(0.5)) { const t = this._bestTorpedo(score); if (t) return card('torpedo', t); }
          if (playable('stone') && chance(0.6)) { const t = this._bestStone(score); if (t) return card('stone', t); }
          if (playable('flare') && chance(0.6)) { const t = this._bestFlare(score); if (t) return card('flare', t); }
          if (playable('sonar') && chance(0.6)) { const t = this._bestSonar(score); if (t) return card('sonar', t); }
          if (playable('recon') && chance(0.5)) { const t = this._bestRecon(score); if (t) return card('recon', t); }
          if (playable('double') && chance(0.4)) return card('double');
          if (playable('parallel') && chance(0.4)) { const t = this._bestLine3(score); if (t) return card('parallel', t); }
          if (playable('chain') && chance(0.3)) return card('chain');
        }
      }

      if (g.jammed || g.barrageLanded) return { kind: 'end' }; // Software Bug, or our barrage was this turn's shot
      const t = this.bestCell(score);
      return { kind: 'fire', r: t.r, c: t.c };
    }

    act() {
      const a = this.nextAction();
      let out;
      if (a.kind === 'fire') out = this.game.fire(this.p, a.r, a.c);
      else if (a.kind === 'end') out = this.game.endTurn(this.p);
      else out = this.game.playCard(this.p, a.handIndex, a.target);
      return { action: a, ...out };
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { AI };
  else root.SonarSalvo.AI = AI;
})(typeof window !== 'undefined' ? window : globalThis);
