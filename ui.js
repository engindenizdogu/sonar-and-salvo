/* Sonar & Salvo: browser UI */
(function () {
  'use strict';

  const S = window.SonarSalvo;
  const { SIZE, CARDS, CARD_ORDER, DECK, SHOT, FLEET, BACKUP_SHIP, MINEFIELD_SIZE, CARGO_TURNS } = S;
  const COLS = 'ABCDEFGHIJ';
  const AI_DELAY = 750;
  const MAX_PINGS = 3;

  const $ = (id) => document.getElementById(id);
  const el = {
    app: $('app'), status: $('status'),
    playerWrap: $('playerWrap'), enemyWrap: $('enemyWrap'),
    playerBoard: $('playerBoard'), enemyBoard: $('enemyBoard'),
    playerFleet: $('playerFleet'), enemyFleet: $('enemyFleet'),
    shipyard: $('shipyard'), startBtn: $('startBtn'),
    rotateBtn: $('rotateBtn'), randomBtn: $('randomBtn'), clearBtn: $('clearBtn'),
    hand: $('hand'), cardHint: $('cardHint'), cardRotateBtn: $('cardRotateBtn'), cardCancelBtn: $('cardCancelBtn'), endTurnBtn: $('endTurnBtn'),
    deckCount: $('deckCount'), discardCount: $('discardCount'), enemyHand: $('enemyHand'),
    log: $('log'), modal: $('modal'), modalTitle: $('modalTitle'), modalBody: $('modalBody'), modalActions: $('modalActions'),
    helpBtn: $('helpBtn'), restartBtn: $('restartBtn'),
  };

  const coord = (r, c) => `${COLS[c]}${r + 1}`;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const lineName = (line, index) => (line === 'row' ? `row ${index + 1}` : `column ${COLS[index]}`);
  const isHit = (r) => r.result === 'hit' || r.result === 'sunk' || r.result === 'decoy';
  const KIND_LABEL = { attack: 'Attack · then your shot', utility: 'Utility · before attacks', free: 'Free · no limit', locked: 'Locked' };

  // ---- state ---------------------------------------------------------
  let game, ai;
  let selectedShip = 0;      // setup: ship being placed
  let horizontal = true;     // setup: orientation
  let pending = null;        // card awaiting targets: { key, handIndex, step, ship, horizontal, origin, picks }
  let busy = false;          // computer is acting
  let hoverPlayer = null;    // [r, c]
  let hoverEnemy = null;     // [r, c]
  let generation = 0;        // invalidates pending AI timers on restart
  let hint = null;           // { text, alert }
  const pingsShown = [0, 0];

  const cells = { player: [], enemy: [] };

  // ---- board construction ---------------------------------------------
  function place(node, row, col) {
    node.style.gridRow = String(row);
    node.style.gridColumn = String(col);
  }

  function buildBoard(boardEl, store) {
    boardEl.innerHTML = '';
    const corner = document.createElement('div');
    corner.className = 'label';
    place(corner, 1, 1);
    boardEl.appendChild(corner);
    for (let c = 0; c < SIZE; c++) {
      const l = document.createElement('div');
      l.className = 'label';
      l.textContent = COLS[c];
      place(l, 1, c + 2);
      boardEl.appendChild(l);
    }
    for (let r = 0; r < SIZE; r++) {
      const l = document.createElement('div');
      l.className = 'label';
      l.textContent = r + 1;
      place(l, r + 2, 1);
      boardEl.appendChild(l);
      store[r] = [];
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.r = r;
        cell.dataset.c = c;
        place(cell, r + 2, c + 2);
        boardEl.appendChild(cell);
        store[r][c] = cell;
      }
    }
  }

  function cellFromEvent(e) {
    const cell = e.target.closest('.cell');
    return cell ? [Number(cell.dataset.r), Number(cell.dataset.c)] : null;
  }

  // ---- game lifecycle -------------------------------------------------
  function newGame() {
    generation++;
    game = new S.Game();
    game.boards[1].randomize();
    ai = null;
    selectedShip = 0;
    horizontal = true;
    pending = null;
    busy = false;
    hint = null;
    hoverPlayer = hoverEnemy = null;
    pingsShown[0] = pingsShown[1] = 0;
    el.log.innerHTML = '';
    closeModal();
    render();
  }

  function startBattle() {
    if (!game.boards[0].allPlaced()) return;
    ai = new S.AI(game, 1);
    const events = game.start(0);
    selectedShip = null;
    addLog('Battle stations. You have the first shot.', 'you');
    const opening = events.filter((e) => e.type === 'draw' && e.player === 0).map((e) => CARDS[e.card].name);
    addLog(`Your opening hand: ${opening.join(', ')}.`, 'you');
    render();
  }

  // ---- logging ----------------------------------------------------------
  function addLog(text, who, big = false) {
    const li = document.createElement('li');
    li.className = `${who}${big ? ' big' : ''}`;
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = `T${Math.max(1, Math.ceil(game.turnNumber / 2))}`;
    li.appendChild(t);
    li.appendChild(document.createTextNode(text));
    el.log.prepend(li);
  }

  function strikeSummary(results) {
    const hits = results.filter(isHit).length;
    const blocked = results.filter((r) => r.result === 'blocked').length;
    let text = `${plural(hits, 'hit')} from ${plural(results.length, 'cell')}`;
    if (blocked) text += `, ${blocked} deflected by a shield`;
    return text;
  }

  function cardMessage(ev, mine) {
    const res = ev.results || [];
    if (mine && ev.smoked && res.length) return `${CARDS[ev.card].name} fired into the smoke: results hidden until your next turn.`;
    switch (ev.card) {
      case 'sonar': {
        if (!mine) return `Enemy sonar pinged your waters around ${coord(ev.r, ev.c)}.`;
        const area = `${coord(ev.r - 1, ev.c - 1)}–${coord(ev.r + 1, ev.c + 1)}`;
        return `Sonar Ping on ${area}: ${plural(ev.count, 'ship segment')} detected.`;
      }
      case 'repair':
        return mine ? `Field Repair patches your ${ev.shipName} at ${coord(ev.r, ev.c)}.` : 'Enemy used Field Repair on a damaged segment.';
      case 'maintenance':
        return mine ? `Full Maintenance restores your ${ev.shipName} to full strength.` : 'Enemy used Full Maintenance. One of their ships is fully repaired.';
      case 'move':
        return mine ? `Your ${ev.shipName} slips away to a new position.` : 'Enemy moved a ship. Your old markers on it are gone.';
      case 'backup':
        return mine ? `A ${ev.shipName} joins your fleet.` : `Enemy called for backup: a 2-cell ${BACKUP_SHIP.name} is now hidden in their waters.`;
      case 'shield':
        return mine ? `Rocket Shield raised over your ${ev.shipName} through the enemy's next turn.` : 'Enemy raised a Rocket Shield over one of their ships for your next turn.';
      case 'scrambler':
        return mine ? `Your ${ev.shipName} is now invisible to sonar.` : 'Enemy scrambled a ship. Sonar can no longer detect it.';
      case 'carepackage':
        return mine ? `Care Package: sent ${CARDS[ev.returned].name} back to the deck.` : 'Enemy opened a Care Package and swapped a card.';
      case 'double':
        return mine ? 'Double Salvo loaded: two shots this turn.' : 'Enemy loads a Double Salvo.';
      case 'torpedo': {
        const contact = res.find((r) => r.result !== 'miss');
        const water = plural(res.filter((r) => r.result === 'miss').length, 'cell');
        const from = mine ? `from your ${ev.shipName} at ${coord(ev.r, ev.c)}` : `from ${coord(ev.r, ev.c)}`;
        let text = `${mine ? 'Torpedo' : 'Enemy torpedo'} launched ${from}, heading ${ev.dir}`;
        if (!contact) return `${text}: no contact, ${water} of open water charted.`;
        text += `: ${water} of open water, then `;
        if (contact.result === 'blocked') return `${text}it is deflected by a shield at ${coord(contact.r, contact.c)}.`;
        if (contact.result === 'mine') return `${text}it ${mine ? 'runs into a hidden mine field' : 'detonates your mine field'} at ${coord(contact.r, contact.c)}!`;
        return `${text}${mine ? 'impact' : `it strikes your ${contact.shipName}`} at ${coord(contact.r, contact.c)}!`;
      }
      case 'cluster':
        return `${mine ? 'Cluster Bomb' : 'Enemy Cluster Bomb'} on ${coord(ev.r, ev.c)}: ${strikeSummary(res)}.`;
      case 'parallel':
        return `${mine ? 'Parallel Shots' : 'Enemy Parallel Shots'} ${ev.horizontal ? 'across' : 'down'} ${coord(ev.r, ev.c)}: ${strikeSummary(res)}.`;
      case 'rapid':
        return `${mine ? 'Rapid Fire' : 'Enemy Rapid Fire'} on ${res.map((r) => coord(r.r, r.c)).join(', ')}: ${strikeSummary(res)}.`;
      case 'minefield':
        return mine ? 'Mine field laid. It waits for an enemy torpedo.' : 'Enemy laid a hidden mine field. Torpedoes beware.';
      case 'decoy':
        return mine ? `A ${ev.shipName} is in position.` : 'Enemy deployed a Decoy: a fake 2-cell ship is hiding among their fleet.';
      case 'bug':
        return mine ? 'Software Bug uploaded: the enemy can’t fire or attack next turn.' : 'Enemy planted a Software Bug: you can’t fire or play attack cards next turn.';
      case 'recon':
        return mine
          ? `Recon Flight over ${lineName(ev.line, ev.index)}: ${ev.found ? 'ships spotted!' : 'no intact ships.'}`
          : `Enemy recon flight passed over your ${lineName(ev.line, ev.index)}.`;
      case 'seals':
        return mine ? `The Seals raided the enemy: their ${CARDS[ev.removed].name} went back into the deck.` : `Enemy Seals raid: your ${CARDS[ev.removed].name} was shuffled back into the deck.`;
      case 'spy':
        return mine ? `Spy Satellite: you sent the enemy’s ${CARDS[ev.removed].name} back into the deck.` : `Enemy Spy Satellite saw your hand and sent your ${CARDS[ev.removed].name} back into the deck.`;
      case 'cargo':
        return mine ? `Heavy Cargo dumped on the enemy: it blocks one of their hand slots for ${CARGO_TURNS} turns.` : `The enemy dumped Heavy Cargo on you: it blocks one hand slot for your next ${CARGO_TURNS} turns.`;
      case 'smoke':
        return mine ? 'Smoke Screen deployed: the enemy fires blind next turn.' : 'Enemy laid a Smoke Screen: next turn you won’t see your shot results until the turn after.';
      case 'trail':
        return mine ? 'Follow the Trail armed: the next enemy hit on your fleet will give one of their ships away.' : 'Enemy armed Follow the Trail. Your next hit on them will reveal one of your ships.';
      case 'salvage':
        return mine ? `Salvaged ${CARDS[ev.taken].name} from the discard pile.` : `Enemy salvaged ${CARDS[ev.taken].name} from the discard pile.`;
      default:
        return `${mine ? 'You' : 'Enemy'} played ${CARDS[ev.card].name}.`;
    }
  }

  function logEvents(events, actor) {
    const who = actor === 0 ? 'you' : 'enemy';
    const sunkLines = [];

    for (const ev of events) {
      (ev.results || []).forEach((r) => {
        if (r.result === 'sunk') sunkLines.push([actor === 0 ? `You sank the enemy ${r.shipName}!` : `The enemy sank your ${r.shipName}.`, who]);
        if (r.result === 'decoy') sunkLines.push([actor === 0 ? 'That “ship” was a Decoy! Nothing real was there.' : `The enemy destroyed your ${r.shipName}.`, who]);
      });

      switch (ev.type) {
        case 'shot': {
          const r = ev.results[0];
          const at = coord(r.r, r.c);
          const verb = actor === 0 ? 'You fire at' : 'Enemy fires at';
          if (actor === 0 && ev.smoked && r.result !== 'sunk') addLog(`${verb} ${at}: lost in the smoke.`, who);
          else if (r.result === 'miss') addLog(`${verb} ${at}: splash.`, who);
          else if (r.result === 'blocked') addLog(actor === 0 ? `${verb} ${at}: deflected by a Rocket Shield. There's a ship there!` : `${verb} ${at}: your ${r.shipName}'s shield holds.`, who);
          else addLog(actor === 0 ? `${verb} ${at}: hit!` : `${verb} ${at}: your ${r.shipName} is hit!`, who);
          break;
        }
        case 'card':
          addLog(cardMessage(ev, actor === 0), who);
          break;
        case 'draw': {
          const mine = ev.player === 0;
          if (ev.skipped) {
            if (mine) addLog(`Your hand is full (${DECK.handMax}), so you skip a draw.`, 'you');
            break;
          }
          if (ev.reason === 'sunk') {
            sunkLines.push([mine ? `You draw a bonus card for your loss: ${CARDS[ev.card].name}.` : 'The enemy draws a bonus card for their loss.', mine ? 'you' : 'enemy']);
          } else if (mine && ev.reason === 'carepackage') {
            addLog(`Care Package delivers: ${CARDS[ev.card].name}.`, 'you');
          } else if (mine && ev.reason === 'turn') {
            addLog(`You draw ${CARDS[ev.card].name}.`, 'you');
          }
          break;
        }
        case 'jammed':
          addLog(ev.player === 0
            ? 'Software Bug! Your guns are offline this turn. You can still play one utility card, then end your turn.'
            : 'The enemy’s guns are jammed by your Software Bug.', ev.player === 0 ? 'you' : 'enemy', true);
          break;
        case 'smoked':
          addLog(ev.player === 0
            ? 'Smoke Screen! You fire blind this turn: results show at the start of your next turn.'
            : 'The enemy is firing blind through your smoke.', ev.player === 0 ? 'you' : 'enemy', true);
          break;
        case 'smoke-clear': {
          if (ev.player !== 0) break;
          const shots = game.boards[1];
          const hits = ev.cells.filter(([r, c]) => shots.shotAt(r, c) === SHOT.HIT).length;
          const blocked = ev.cells.filter(([r, c]) => shots.shotAt(r, c) === SHOT.BLOCKED).length;
          addLog(`The smoke clears: ${plural(hits, 'hit')}${blocked ? `, ${blocked} shielded` : ''} out of ${plural(ev.cells.length, 'shot')}.`, 'you');
          break;
        }
        case 'trail':
          addLog(ev.player === 0
            ? `Follow the Trail: you traced the attack back! An enemy ship segment is spotted at ${coord(ev.r, ev.c)}.`
            : `The enemy followed your trail: your ship at ${coord(ev.r, ev.c)} has been spotted.`, ev.player === 0 ? 'you' : 'enemy', true);
          break;
        case 'cargo-sink':
          addLog(ev.player === 0 ? 'Your Heavy Cargo sinks. The hand slot is free again.' : 'The Heavy Cargo you dumped on the enemy sinks.', ev.player === 0 ? 'you' : 'enemy');
          break;
        case 'pass':
          addLog(actor === 0 ? 'You end your turn without firing.' : 'The enemy ends their turn without firing.', who);
          break;
        case 'reshuffle':
          addLog('The discard pile is shuffled back into the deck.', who);
          break;
        default:
          break;
      }
    }
    sunkLines.forEach(([t, w]) => addLog(t, w, true));
  }

  // ---- effects ----------------------------------------------------------
  function flash(store, r, c, kind) {
    const cell = store[r] && store[r][c];
    if (!cell) return;
    const fx = document.createElement('span');
    fx.className = `fx fx-${kind}`;
    fx.addEventListener('animationend', () => fx.remove());
    cell.appendChild(fx);
    setTimeout(() => fx.remove(), 1200);
  }

  function playEffects(events, actor) {
    const target = actor === 0 ? cells.enemy : cells.player;
    const own = actor === 0 ? cells.player : cells.enemy;
    const kinds = { miss: 'miss', blocked: 'shield', hit: 'hit', sunk: 'hit', decoy: 'hit', mine: 'mine' };
    for (const ev of events) {
      const blind = actor === 0 && ev.smoked;
      (ev.results || []).forEach((r, i) => {
        setTimeout(() => flash(target, r.r, r.c, blind && r.result !== 'sunk' ? 'smoke' : kinds[r.result]), i * 70);
      });
      // Only show your own repairs; the enemy's would give their position away.
      if (actor === 0 && ev.card === 'repair') flash(own, ev.r, ev.c, 'repair');
    }
  }

  // ---- actions ----------------------------------------------------------
  function apply(res, actor) {
    if (!res.ok) {
      if (actor === 0) setHint(res.reason, true);
      render();
      return false;
    }
    if (actor === 0) { pending = null; hint = null; }
    logEvents(res.events, actor);
    render();
    playEffects(res.events, actor);

    if (game.phase === 'over') setTimeout(showGameOver, 700);
    else if (game.turn === 1 && actor === 0) runAI();
    return true;
  }

  function runAI() {
    busy = true;
    render();
    const gen = generation;
    const step = () => {
      if (gen !== generation) return;
      if (game.phase !== 'battle' || game.turn !== 1) { busy = false; render(); return; }
      apply(ai.act(), 1);
      if (game.phase === 'battle' && game.turn === 1) setTimeout(step, AI_DELAY);
      else { busy = false; render(); }
    };
    setTimeout(step, AI_DELAY);
  }

  const humanCanAct = () => game.phase === 'battle' && game.turn === 0 && !busy;

  function setHint(text, alert = false) {
    hint = text ? { text, alert } : null;
  }

  function rapidNeed() {
    let open = 0;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (game.boards[1].targetable(r, c)) open++;
    return Math.min(4, open);
  }

  function instructions() {
    if (!pending) return '';
    const { key, step } = pending;
    // Functions so only the active card's text is built (others may reference unset fields).
    const text = {
      sonar: () => 'Pick the center of a 3×3 area in enemy waters.',
      cluster: () => 'Pick the center of the plus-shaped strike in enemy waters.',
      parallel: () => 'Pick the middle of the 3-cell line in enemy waters. Press R to rotate.',
      rapid: () => `Pick ${rapidNeed()} cells in enemy waters (${pending.picks.length}/${rapidNeed()} chosen). Click a pick again to undo it.`,
      torpedo: () => (step === 'origin'
        ? 'Pick the segment of one of your ships to launch from, on your board.'
        : `Launching from ${coord(...pending.origin)}. Click a highlighted cell in enemy waters to choose a direction.`),
      repair: () => 'Pick a damaged (pulsing) segment on your board.',
      maintenance: () => 'Pick a damaged ship on your board.',
      shield: () => 'Pick the ship to shield on your board.',
      scrambler: () => 'Pick the ship to hide from sonar on your board.',
      move: () => (step === 'own-ship'
        ? 'Pick the ship to move on your board.'
        : `Choose a new spot for your ${game.boards[0].ships[pending.ship].name}. Press R to rotate. Cells the enemy has marked are off limits.`),
      backup: () => 'Choose where to deploy the 2×1 Patrol Boat on your board. Press R to rotate.',
      carepackage: () => 'Pick another card in your hand to send back to the deck.',
      minefield: () => 'Choose open water on your board for the 3×1 mine field. Press R to rotate.',
      decoy: () => 'Choose where to hide the 2×1 Decoy on your board. Press R to rotate.',
      recon: () => `Pick a ${pending.horizontal ? 'row' : 'column'} in enemy waters to fly over. Press R to switch to ${pending.horizontal ? 'columns' : 'rows'}.`,
      salvage: () => 'Choose a card from the discard pile.',
      spy: () => 'Choose one of the enemy’s cards to send back to the deck.',
    }[key];
    return `${text()} Esc cancels.`;
  }

  function cancelPending() {
    pending = null;
    hint = null;
    render();
  }

  function play(target) {
    apply(game.playCard(0, pending.handIndex, target), 0);
  }

  const FIRST_STEP = {
    sonar: 'enemy', cluster: 'enemy', parallel: 'enemy', rapid: 'enemy',
    torpedo: 'origin', repair: 'own-cell', maintenance: 'own-ship', shield: 'own-ship',
    scrambler: 'own-ship', move: 'own-ship', backup: 'place', carepackage: 'hand',
    minefield: 'place', decoy: 'place', recon: 'enemy', salvage: 'modal', spy: 'modal',
  };
  const INSTANT = ['double', 'seals', 'bug', 'cargo', 'smoke', 'trail']; // no target needed

  function selectCard(i) {
    if (!humanCanAct()) return;
    const key = game.hands[0][i];
    if (!key) return;
    if (pending && pending.key === 'carepackage' && i !== pending.handIndex) {
      play({ returnIndex: i });
      return;
    }
    if (pending && pending.handIndex === i) { cancelPending(); return; }
    const blocker = game.cardBlocker(0, key);
    if (blocker) { setHint(`${CARDS[key].name}: ${blocker.toLowerCase()}.`, true); render(); return; }
    if (INSTANT.includes(key)) {
      pending = { key, handIndex: i };
      play({});
      return;
    }
    pending = { key, handIndex: i, step: FIRST_STEP[key], horizontal: true, picks: [] };
    hint = null;
    render();
    if (pending.step === 'modal') openChooser();
  }

  // Salvage and Spy Satellite pick a card from a list shown in the modal.
  function openChooser() {
    const fromDiscard = pending.key === 'salvage';
    const options = fromDiscard
      ? [...new Set(game.discard.filter((k) => !S.SINGLE_USE.includes(k)))].map((k) => ({ key: k, target: { card: k }, note: `${game.discard.filter((d) => d === k).length} in discard` }))
      : game.hands[1].map((k, index) => ({ key: k, target: { index }, note: '' })).filter((o) => o.key !== 'cargoload');
    const cardsHTML = options.map((o, i) => {
      const c = CARDS[o.key];
      return `<button class="card kind-${c.kind}" data-pick="${i}">
        <div class="card-top"><span class="card-icon" aria-hidden="true">${c.icon}</span><span class="card-key">${o.note}</span></div>
        <div class="card-name">${c.name}</div>
        <div class="card-desc">${c.desc}</div></button>`;
    }).join('');
    openModal(fromDiscard ? 'Salvage: take a card' : 'Spy Satellite: the enemy’s hand',
      `<p>${fromDiscard ? 'Pick a card from the discard pile to add to your hand.' : 'Pick one card to shuffle back into the deck.'}</p><div class="hand chooser">${cardsHTML}</div>`,
      [{ label: 'Cancel', onClick: () => { closeModal(); cancelPending(); } }]);
    el.modalBody.querySelectorAll('[data-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        closeModal();
        play(options[Number(btn.dataset.pick)].target);
      });
    });
  }

  function rotatePending() {
    if (pending && (pending.key === 'parallel' || pending.key === 'recon' || pending.step === 'place')) {
      pending.horizontal = !pending.horizontal;
      render();
      return true;
    }
    return false;
  }

  // ---- event wiring -----------------------------------------------------
  el.playerBoard.addEventListener('click', (e) => {
    const pos = cellFromEvent(e);
    if (!pos) return;
    const [r, c] = pos;
    const board = game.boards[0];

    if (game.phase === 'setup') {
      const s = board.shipAt(r, c);
      if (s !== -1) {
        horizontal = board.ships[s].horizontal;
        board.remove(s);
        selectedShip = s;
      } else if (selectedShip !== null && board.place(selectedShip, r, c, horizontal)) {
        const next = board.ships.findIndex((sh) => !sh.placed);
        selectedShip = next === -1 ? null : next;
      }
      render();
      return;
    }

    if (!pending || !humanCanAct()) return;
    const s = board.shipAt(r, c);
    switch (pending.step) {
      case 'own-cell':
        play({ r, c });
        break;
      case 'own-ship':
        if (s === -1) return;
        if (pending.key === 'move') {
          if (board.isSunk(s)) { setHint('That ship is already sunk.', true); render(); return; }
          pending.ship = s;
          pending.horizontal = board.ships[s].horizontal;
          pending.step = 'place';
          hint = null;
          render();
        } else {
          play({ ship: s });
        }
        break;
      case 'origin':
        if (s === -1 || board.isSunk(s)) { setHint('Launch from a ship that is still afloat.', true); render(); return; }
        pending.origin = [r, c];
        pending.step = 'aim';
        hint = null;
        render();
        break;
      case 'place':
        if (pending.key === 'move') play({ ship: pending.ship, r, c, horizontal: pending.horizontal });
        else play({ r, c, horizontal: pending.horizontal });
        break;
      default:
        break;
    }
  });

  el.playerBoard.addEventListener('mouseover', (e) => {
    const pos = cellFromEvent(e);
    if (pos && (!hoverPlayer || pos[0] !== hoverPlayer[0] || pos[1] !== hoverPlayer[1])) {
      hoverPlayer = pos;
      renderBoards();
    }
  });
  el.playerBoard.addEventListener('mouseleave', () => { hoverPlayer = null; renderBoards(); });

  el.enemyBoard.addEventListener('click', (e) => {
    const pos = cellFromEvent(e);
    if (!pos || !humanCanAct()) return;
    const [r, c] = pos;
    const eb = game.boards[1];

    if (!pending) {
      if (game.jammed) { setHint('Software Bug: you can’t fire this turn. End your turn when ready.', true); render(); return; }
      if (eb.targetable(r, c)) apply(game.fire(0, r, c), 0);
      return;
    }
    if (pending.step === 'enemy') {
      if (pending.key === 'rapid') {
        const at = pending.picks.findIndex(([a, b]) => a === r && b === c);
        if (at >= 0) pending.picks.splice(at, 1);
        else if (eb.targetable(r, c)) pending.picks.push([r, c]);
        if (pending.picks.length >= rapidNeed()) play({ cells: pending.picks });
        else render();
      } else if (pending.key === 'parallel') {
        play({ r, c, horizontal: pending.horizontal });
      } else if (pending.key === 'recon') {
        play(pending.horizontal ? { line: 'row', index: r } : { line: 'col', index: c });
      } else {
        play({ r, c });
      }
    } else if (pending.step === 'aim') {
      const dir = S.directionTo(pending.origin[0], pending.origin[1], r, c);
      if (!dir) { setHint('Click a cell in the same row or column as the launch point.', true); render(); return; }
      play({ r: pending.origin[0], c: pending.origin[1], dir });
    }
  });

  el.enemyBoard.addEventListener('mouseover', (e) => {
    const pos = cellFromEvent(e);
    if (pos && (!hoverEnemy || pos[0] !== hoverEnemy[0] || pos[1] !== hoverEnemy[1])) {
      hoverEnemy = pos;
      renderBoards();
    }
  });
  el.enemyBoard.addEventListener('mouseleave', () => { hoverEnemy = null; renderBoards(); });

  el.rotateBtn.addEventListener('click', () => { horizontal = !horizontal; render(); });
  el.randomBtn.addEventListener('click', () => {
    game.boards[0].randomize();
    selectedShip = null;
    render();
  });
  el.clearBtn.addEventListener('click', () => {
    game.boards[0].clearShips();
    selectedShip = 0;
    render();
  });
  el.startBtn.addEventListener('click', startBattle);
  el.cardRotateBtn.addEventListener('click', rotatePending);
  el.cardCancelBtn.addEventListener('click', cancelPending);
  el.endTurnBtn.addEventListener('click', () => { if (humanCanAct()) { pending = null; apply(game.endTurn(0), 0); } });

  el.hand.addEventListener('click', (e) => {
    const btn = e.target.closest('.card');
    if (btn) selectCard(Number(btn.dataset.index));
  });

  el.restartBtn.addEventListener('click', () => {
    if (game.phase === 'battle' && !window.confirm('Abandon this battle and start a new game?')) return;
    newGame();
  });
  el.helpBtn.addEventListener('click', showHelp);

  function dismissModal() {
    closeModal();
    if (pending && pending.step === 'modal') cancelPending();
  }
  el.modal.addEventListener('click', (e) => { if (e.target === el.modal) dismissModal(); });

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (!el.modal.hidden) { dismissModal(); return; }
      if (pending) cancelPending();
      return;
    }
    if (!el.modal.hidden) return;
    if (e.key === 'r' || e.key === 'R') {
      if (game.phase === 'setup') { horizontal = !horizontal; render(); }
      else rotatePending();
      return;
    }
    if (game.phase === 'battle' && /^[1-9]$/.test(e.key)) selectCard(Number(e.key) - 1);
  });

  // ---- rendering ---------------------------------------------------------
  const key = (r, c) => r * SIZE + c;
  const toSet = (list) => new Set(list.map(([r, c]) => key(r, c)));

  function shipClasses(board, s, r, c, cls) {
    const ship = board.ships[s];
    const i = ship.cells.findIndex(([a, b]) => a === r && b === c);
    cls.push('ship', ship.horizontal ? 'h' : 'v');
    if (i === 0) cls.push('end-a');
    if (i === ship.size - 1) cls.push('end-b');
    if (board.isSunk(s)) cls.push('sunk');
  }

  // Ghost preview on your own board (setup placement, Move, Call for Backup).
  function ghostCells() {
    if (!hoverPlayer) return null;
    const [r, c] = hoverPlayer;
    const board = game.boards[0];
    if (game.phase === 'setup' && selectedShip !== null) {
      const size = board.ships[selectedShip].size;
      return { cells: S.shipCells(size, r, c, horizontal), ok: board.canPlace(selectedShip, r, c, horizontal) };
    }
    if (pending && pending.step === 'place' && humanCanAct()) {
      const h = pending.horizontal;
      if (pending.key === 'move') {
        return { cells: S.shipCells(board.ships[pending.ship].size, r, c, h), ok: board.canMove(pending.ship, r, c, h) };
      }
      if (pending.key === 'minefield') {
        return { cells: S.shipCells(MINEFIELD_SIZE, r, c, h), ok: board.canPlaceMines(r, c, h), mine: true };
      }
      return { cells: S.shipCells(BACKUP_SHIP.size, r, c, h), ok: board.canAddShip(r, c, h) };
    }
    return null;
  }

  // Ships / cells on your board that the pending card can target.
  function eligibleOwn() {
    if (!pending || !humanCanAct()) return null;
    const b = game.boards[0];
    const out = new Set();
    const addShip = (i) => b.ships[i].cells.forEach(([r, c]) => out.add(key(r, c)));
    switch (pending.step) {
      case 'own-cell':
        b.repairableCells().forEach(([r, c]) => out.add(key(r, c)));
        break;
      case 'own-ship':
        b.afloat().forEach((i) => {
          if (pending.key === 'maintenance' && !b.canMaintain(i)) return;
          if (pending.key === 'scrambler' && b.ships[i].scrambled) return;
          addShip(i);
        });
        break;
      case 'origin':
        b.afloat().forEach(addShip);
        break;
      default:
        return null;
    }
    return out;
  }

  function enemyPreview() {
    if (!pending || !humanCanAct()) {
      if (hoverEnemy && humanCanAct() && !game.jammed && game.boards[1].targetable(...hoverEnemy)) return { aim: [hoverEnemy], ok: true };
      return null;
    }
    const eb = game.boards[1];
    const open = ([a, b]) => eb.targetable(a, b);
    if (pending.step === 'aim') {
      const [or, oc] = pending.origin;
      const lanes = Object.keys(S.DIRS).flatMap((d) => S.torpedoPath(or, oc, d));
      let aim = [];
      if (hoverEnemy) {
        const dir = S.directionTo(or, oc, hoverEnemy[0], hoverEnemy[1]);
        if (dir) aim = S.torpedoPath(or, oc, dir);
      }
      return { lanes, aim, ok: aim.some(open), origin: pending.origin };
    }
    if (pending.step !== 'enemy') return null;
    const picks = pending.key === 'rapid' ? pending.picks : [];
    if (!hoverEnemy) return { aim: [], picks, ok: true };
    const [r, c] = hoverEnemy;
    let aim;
    if (pending.key === 'sonar') return { aim: S.sonarArea(r, c).cells, picks, ok: true };
    if (pending.key === 'recon') return { aim: pending.horizontal ? S.lineCells('row', r) : S.lineCells('col', c), picks, ok: true };
    if (pending.key === 'cluster') aim = S.clusterArea(r, c);
    else if (pending.key === 'parallel') aim = S.parallelArea(r, c, pending.horizontal);
    else aim = open([r, c]) ? [[r, c]] : [];
    return { aim, picks, ok: aim.some(open) };
  }

  function renderBoards() {
    const over = game.phase === 'over';
    const turn = game.turnNumber;

    // Player board
    const pb = game.boards[0];
    const ghost = ghostCells();
    const ghostSet = ghost ? toSet(ghost.cells) : null;
    const eligible = eligibleOwn();
    const moving = pending && pending.step === 'place' && pending.key === 'move' ? pending.ship : -1;
    const detonatedOwn = toSet(pb.detonated);
    el.playerBoard.classList.toggle('placing', game.phase === 'setup' || !!eligible || !!(pending && pending.step === 'place'));
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const cls = ['cell'];
      const at = pb.segment(r, c);
      const shot = pb.shotAt(r, c);
      if (ghostSet && ghostSet.has(key(r, c))) cls.push('ghost', ghost.ok ? 'ok' : 'bad', ...(ghost.mine ? ['mine-ghost'] : []));
      else if (at) {
        shipClasses(pb, at.ship, r, c, cls);
        const ship = pb.ships[at.ship];
        if (ship.decoy) cls.push('decoy');
        if (at.ship === moving) cls.push('moving');
        if (ship.shieldedUntil >= turn && !pb.isSunk(at.ship)) cls.push('shielded');
        if (ship.scrambled && !pb.isSunk(at.ship)) cls.push('scrambled');
      }
      if (at && pb.ships[at.ship].damage[at.seg]) {
        cls.push('hit');
        if (shot !== SHOT.HIT) cls.push('concealed'); // damaged, but the enemy doesn't know where
      }
      if (shot === SHOT.MISS) cls.push('miss');
      if (shot === SHOT.BLOCKED) cls.push('blocked');
      if (shot === SHOT.SPOTTED) cls.push('spotted');
      if (pb.mineAt(r, c) !== -1) cls.push('mine');
      if (detonatedOwn.has(key(r, c))) cls.push('detonated');
      if (eligible && eligible.has(key(r, c))) {
        cls.push('eligible');
        if (pending.step === 'own-cell') cls.push('repairable'); // Field Repair: pulse the damaged segment
      }
      if (pending && pending.step === 'aim' && pending.origin[0] === r && pending.origin[1] === c) cls.push('origin');
      cells.player[r][c].className = cls.join(' ');
    }

    // Enemy board
    const eb = game.boards[1];
    const prev = enemyPreview();
    const aimSet = prev && prev.aim ? toSet(prev.aim) : null;
    const laneSet = prev && prev.lanes ? toSet(prev.lanes) : null;
    const pickSet = prev && prev.picks ? toSet(prev.picks) : null;
    const canFire = humanCanAct() && (pending ? (pending.step === 'enemy' || pending.step === 'aim') : !game.jammed);
    const detonatedFoe = toSet(eb.detonated);
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const cls = ['cell'];
      const s = eb.shipAt(r, c);
      const shot = eb.shotAt(r, c);
      if (s !== -1 && (eb.isSunk(s) || over)) {
        shipClasses(eb, s, r, c, cls);
        if (eb.ships[s].decoy) cls.push('decoy');
      }
      if (over && eb.mineAt(r, c) !== -1) cls.push('mine');
      if (detonatedFoe.has(key(r, c))) cls.push('detonated');
      if (eb.fog.has(key(r, c))) cls.push('fog'); // you fired here through smoke
      else {
        if (shot === SHOT.MISS) cls.push('miss');
        if (shot === SHOT.HIT) cls.push('hit');
        if (shot === SHOT.BLOCKED) cls.push('blocked');
        if (shot === SHOT.SPOTTED) cls.push('spotted');
      }
      if (canFire && eb.targetable(r, c)) cls.push('open');
      const k = key(r, c);
      if (laneSet && laneSet.has(k)) cls.push('lane');
      if (aimSet && aimSet.has(k)) cls.push('aim', prev.ok ? 'ok' : 'bad');
      if (pickSet && pickSet.has(k)) cls.push('picked');
      if (prev && prev.origin && prev.origin[0] === r && prev.origin[1] === c) cls.push('origin');
      cells.enemy[r][c].className = cls.join(' ');
    }

    renderPings(el.enemyBoard, game.scans[0], 0, '');
    renderPings(el.playerBoard, game.scans[1], 1, 'enemy');
    renderRecons(el.enemyBoard, game.recons[0], '');
    renderRecons(el.playerBoard, game.recons[1], 'enemy');
  }

  // Latest recon flights shown as a strip over the row/column with the answer.
  function renderRecons(boardEl, recons, extra) {
    boardEl.querySelectorAll('.recon').forEach((n) => n.remove());
    recons.slice(-2).forEach((rc, i, list) => {
      const d = document.createElement('div');
      d.className = `recon ${rc.line} ${rc.found ? 'found' : 'clear'} ${extra}${i < list.length - 1 ? ' old' : ''}`;
      if (rc.line === 'row') { d.style.gridRow = String(rc.index + 2); d.style.gridColumn = '2 / span 10'; }
      else { d.style.gridColumn = String(rc.index + 2); d.style.gridRow = '2 / span 10'; }
      const tag = document.createElement('span');
      tag.className = 'recon-tag';
      tag.textContent = rc.found ? '✈ ships' : '✈ clear';
      d.appendChild(tag);
      boardEl.appendChild(d);
    });
  }

  function renderPings(boardEl, scans, p, extra) {
    boardEl.querySelectorAll('.ping').forEach((n) => n.remove());
    // Only the latest few pings stay on the board; the log keeps the full history.
    const firstShown = Math.max(0, scans.length - MAX_PINGS);
    scans.forEach((s, i) => {
      if (i < firstShown) return;
      const d = document.createElement('div');
      const isNew = i >= pingsShown[p];
      const old = i < scans.length - 1;
      d.className = `ping ${extra}${isNew ? ' fresh' : ''}${old ? ' old' : ''}`;
      d.style.gridRow = `${s.r + 1} / span 3`;
      d.style.gridColumn = `${s.c + 1} / span 3`;
      const n = document.createElement('span');
      n.className = 'ping-count';
      n.textContent = s.count;
      n.title = `${s.count} intact segment(s) when pinged`;
      d.appendChild(n);
      boardEl.appendChild(d);
    });
    pingsShown[p] = scans.length;
  }

  function renderFleet(listEl, board, revealDamage) {
    listEl.innerHTML = '';
    board.ships.forEach((ship, i) => {
      const sunk = board.isSunk(i);
      // The enemy's decoy stays secret until it is destroyed (or the game ends).
      if (ship.decoy && !revealDamage && !sunk && game.phase !== 'over') return;
      const li = document.createElement('li');
      if (ship.decoy) li.classList.add('decoy');
      if (sunk) li.classList.add('sunk');
      if (ship.id.startsWith(BACKUP_SHIP.id)) li.classList.add('backup');
      li.title = `${ship.name}${sunk ? ' (sunk)' : ''}`;
      for (let k = 0; k < ship.size; k++) {
        const b = document.createElement('i');
        if (revealDamage && !sunk && ship.damage[k]) b.classList.add('dmg');
        li.appendChild(b);
      }
      listEl.appendChild(li);
    });
  }

  function renderShipyard() {
    const board = game.boards[0];
    el.shipyard.innerHTML = '';
    board.ships.forEach((ship, i) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'ship-pick';
      if (i === selectedShip) btn.classList.add('selected');
      if (ship.placed) btn.classList.add('placed');
      btn.innerHTML = `<span>${ship.name}</span><span class="blocks">${'<i></i>'.repeat(ship.size)}</span>`;
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = ship.placed ? 'placed' : i === selectedShip ? (horizontal ? 'horizontal' : 'vertical') : `${ship.size} cells`;
      btn.appendChild(tag);
      btn.addEventListener('click', () => {
        if (ship.placed) { horizontal = ship.horizontal; board.remove(i); }
        selectedShip = i;
        render();
      });
      li.appendChild(btn);
      el.shipyard.appendChild(li);
    });
    el.startBtn.disabled = !board.allPlaced();
  }

  function renderHand() {
    const hand = game.hands[0];
    el.deckCount.textContent = game.deck.length;
    el.discardCount.textContent = game.discard.length;
    el.enemyHand.textContent = game.hands[1].length;

    const canAct = humanCanAct();
    const choosingReturn = pending && pending.key === 'carepackage';
    el.hand.innerHTML = '';
    if (!hand.length) {
      const empty = document.createElement('p');
      empty.className = 'hand-empty';
      empty.textContent = 'No cards in hand. You draw one at the start of each turn.';
      el.hand.appendChild(empty);
    }
    let cargoSeen = 0;
    hand.forEach((k, i) => {
      const card = CARDS[k];
      const locked = card.kind === 'locked';
      const turnsLeft = locked ? game.cargo[0][cargoSeen++] : 0;
      const btn = document.createElement('button');
      btn.className = `card kind-${card.kind}`;
      btn.dataset.index = i;
      const isArmed = !!pending && pending.handIndex === i;
      const isReturn = !!choosingReturn && !isArmed && !locked;
      const blocker = canAct ? game.cardBlocker(0, k) : 'Wait for your turn';
      btn.disabled = locked || !canAct || (!isArmed && !isReturn && !!blocker);
      btn.classList.toggle('locked', locked);
      btn.classList.toggle('armed', isArmed);
      btn.classList.toggle('return-target', isReturn);
      btn.title = btn.disabled && blocker ? blocker : '';
      btn.innerHTML = `
        <div class="card-top">
          <span class="card-icon" aria-hidden="true">${card.icon}</span>
          <span class="card-key">${i + 1}</span>
        </div>
        <div class="card-name">${card.name}</div>
        <div class="card-tag">${locked ? `Locked · sinks in ${plural(turnsLeft, 'turn')}` : KIND_LABEL[card.kind]}</div>
        <div class="card-desc">${card.desc}</div>`;
      el.hand.appendChild(btn);
    });

    let text = hint ? hint.text : pending ? instructions() : '';
    if (!text && game.phase === 'battle') {
      if (!canAct) text = 'The enemy is taking their turn.';
      else if (game.jammed) text = game.utilityPlayed
        ? 'Software Bug: your guns are offline. End your turn when ready.'
        : 'Software Bug: your guns are offline. You can still play one utility card, then end your turn.';
      else if (game.attackPlayed) text = `Attack done. Now take your regular shot${game.shotsLeft > 1 ? 's' : ''} to end the turn.`;
      else if (game.utilityPlayed) text = 'Utility played. You can still play one attack card, then take your regular shot.';
      else text = 'Your turn: one utility card, then one attack card, then your regular shot. All optional except the shot.';
      if (canAct && game.smoked) text = `Firing blind (Smoke Screen). ${text}`;
    }
    el.cardHint.textContent = text;
    el.cardHint.classList.toggle('alert', !!(hint && hint.alert));
    el.cardRotateBtn.hidden = !(pending && (pending.key === 'parallel' || pending.key === 'recon' || pending.step === 'place'));
    el.cardCancelBtn.hidden = !pending;
    el.endTurnBtn.hidden = !(canAct && game.jammed);
  }

  function renderStatus() {
    let text = '', cls = '';
    if (game.phase === 'setup') {
      text = game.boards[0].allPlaced() ? 'Fleet ready. Start the battle.' : 'Deploy your fleet';
    } else if (game.phase === 'over') {
      text = game.winner === 0 ? 'Victory! Enemy fleet destroyed' : 'Defeat. Your fleet is lost';
      cls = game.winner === 0 ? 'your-turn' : 'enemy-turn';
    } else if (game.turn === 0 && !busy) {
      cls = 'your-turn';
      if (pending) text = `Your turn: ${CARDS[pending.key].name}`;
      else if (game.jammed) text = 'Your turn: guns offline (Software Bug)';
      else if (game.smoked) text = 'Your turn: firing blind (Smoke Screen)';
      else if (game.shotsLeft > 1) text = `Your turn: ${game.shotsLeft} shots left`;
      else text = 'Your turn: fire on enemy waters';
    } else {
      cls = 'enemy-turn';
      text = 'Enemy is maneuvering…';
    }
    el.status.textContent = text;
    el.status.className = `status ${cls}`;
  }

  function render() {
    el.app.className = game.phase === 'setup' ? 'phase-setup' : 'phase-battle';
    const battle = game.phase === 'battle';
    const yourMove = battle && game.turn === 0 && !busy;
    const ownFocus = yourMove && pending && ['own-cell', 'own-ship', 'origin', 'place'].includes(pending.step);
    // Glow the board you should be looking at.
    const gunsOffline = game.jammed && !pending; // Software Bug: nothing to aim at
    el.enemyWrap.className = `board-wrap${yourMove && !ownFocus && !gunsOffline ? ' active targeting' : ''}`;
    el.playerWrap.className = `board-wrap${ownFocus ? ' active targeting' : battle && !yourMove ? ' active defending' : ''}`;
    renderBoards();
    if (game.phase === 'setup') renderShipyard();
    renderFleet(el.playerFleet, game.boards[0], true);
    renderFleet(el.enemyFleet, game.boards[1], false);
    renderHand();
    renderStatus();
  }

  // ---- modals ------------------------------------------------------------
  function openModal(title, bodyHTML, actions, titleClass = '') {
    el.modalTitle.textContent = title;
    el.modalTitle.className = titleClass;
    el.modalBody.innerHTML = bodyHTML;
    el.modalActions.innerHTML = '';
    actions.forEach(({ label, primary, onClick }) => {
      const b = document.createElement('button');
      b.className = `btn${primary ? ' primary' : ''}`;
      b.textContent = label;
      b.addEventListener('click', onClick);
      el.modalActions.appendChild(b);
    });
    el.modal.hidden = false;
    const focusTarget = el.modalActions.querySelector('.primary') || el.modalActions.querySelector('button');
    if (focusTarget) focusTarget.focus();
  }

  function closeModal() { el.modal.hidden = true; }

  function showHelp() {
    const group = (kind) => CARD_ORDER.filter((k) => CARDS[k].kind === kind)
      .map((k) => `<li><strong>${CARDS[k].icon} ${CARDS[k].name}:</strong> ${CARDS[k].desc}</li>`).join('');
    const fleet = FLEET.map((s) => `${s.name} (${s.size})`).join(', ');
    openModal('How to play', `
      <p>Hide your fleet, then take turns firing at the enemy grid. Sink every enemy ship before they sink yours.</p>
      <ul>
        <li><strong>Fleet:</strong> ${fleet}.</li>
        <li><strong>Cards:</strong> both players draw from one shared deck. You start with ${DECK.startHand} cards and draw 1 at the start of every turn. You can hold at most ${DECK.handMax}; with a full hand you skip the draw.</li>
        <li><strong>Your turn:</strong> optionally play one utility card, then optionally one attack card, then take your regular shot, which ends the turn. Utility cards can’t be played after an attack. Care Package is free at any point.</li>
        <li><strong>Comeback draw:</strong> when one of your ships is sunk, you draw a bonus card.</li>
      </ul>
      <p class="help-group">Attack cards</p><ul>${group('attack')}</ul>
      <p class="help-group">Utility cards</p><ul>${group('utility')}${group('free')}</ul>
      <p>Shortcuts: <kbd>R</kbd> rotates (deployment, Move, Backup, Decoy, Mine Field, Parallel Shots, Recon Flight), <kbd>1</kbd>–<kbd>${DECK.handMax}</kbd> pick a card, and <kbd>Esc</kbd> cancels.</p>
    `, [{ label: 'Got it', primary: true, onClick: closeModal }]);
  }

  function showGameOver() {
    const won = game.winner === 0;
    const st = game.stats;
    const acc = (s) => (s.shots ? `${Math.round((s.hits / s.shots) * 100)}%` : '–');
    const row = (label, a, b) => `<span class="h">${label}</span><span class="v">${a}</span><span class="v">${b}</span>`;
    openModal(won ? 'Victory' : 'Defeat', `
      <p>${won ? 'The enemy fleet rests on the seabed. Fine shooting, Admiral.' : 'Your last ship goes under. The enemy fleet is now revealed on their board.'}</p>
      <div class="stats">
        ${row('', 'You', 'Enemy')}
        ${row('Ships sunk', st[0].sunk, st[1].sunk)}
        ${row('Cells struck', st[0].shots, st[1].shots)}
        ${row('Accuracy', acc(st[0]), acc(st[1]))}
        ${row('Cards played', st[0].cards, st[1].cards)}
      </div>
    `, [
      { label: 'Review board', onClick: closeModal },
      { label: 'Play again', primary: true, onClick: newGame },
    ], won ? 'win' : 'lose');
  }

  // ---- boot ----------------------------------------------------------------
  buildBoard(el.playerBoard, cells.player);
  buildBoard(el.enemyBoard, cells.enemy);
  newGame();

  let seenHelp = false;
  try { seenHelp = localStorage.getItem('sonar-salvo-help-v2') === '1'; } catch (e) { /* storage unavailable */ }
  if (!seenHelp) {
    showHelp();
    try { localStorage.setItem('sonar-salvo-help-v2', '1'); } catch (e) { /* ignore */ }
  }
})();
