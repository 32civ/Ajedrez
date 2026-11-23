"use strict";

/* =====================================================
   ENROQUE · Ajedrez local sin dependencias
   - Motor legal con enroque, captura al paso y coronación
   - Interfaz por turnos y reloj opcional por jugador
   ===================================================== */

const GLYPHS = Object.freeze({
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟︎"
});
const FILES = "abcdefgh";
const DIRECTIONS = {
  n: [-33, -31, -18, -14, 14, 18, 31, 33],
  b: [-17, -15, 15, 17],
  r: [-16, -1, 1, 16],
  k: [-17, -16, -15, -1, 1, 15, 16, 17]
};
const ALL_DIRECTIONS = DIRECTIONS.k;
const PIECE_NAMES = {p: "peón", r: "torre", n: "caballo", b: "alfil", q: "reina", k: "rey"};
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// El tablero 0x88 ocupa 128 posiciones; las 64 válidas son las que no tienen el bit 0x88.
const onBoard = i => i >= 0 && i < 128 && (i & 0x88) === 0;
const pieceSide = piece => !piece || piece === "." ? 0 : piece === piece.toUpperCase() ? 1 : -1;
const colorKey = side => side === 1 ? "w" : "b";
const toSquare = i => FILES[i & 7] + (8 - (i >> 4));
const fromSquare = s => (8 - Number(s[1])) * 16 + FILES.indexOf(s[0]);

function parseFen(fen) {
  const [placement, turn, rights, ep, halfmove, fullmove] = fen.split(" ");
  const board = Array(128).fill(".");
  placement.split("/").forEach((rank, row) => {
    let col = 0;
    for (const item of rank) {
      if (/^[1-8]$/.test(item)) col += Number(item);
      else board[row * 16 + col++] = item;
    }
  });
  return {
    board, turn: turn === "w" ? 1 : -1,
    castle: (rights.includes("K") ? 1 : 0) | (rights.includes("Q") ? 2 : 0) |
      (rights.includes("k") ? 4 : 0) | (rights.includes("q") ? 8 : 0),
    enPassant: ep === "-" ? -1 : fromSquare(ep),
    halfmove: Number(halfmove), fullmove: Number(fullmove)
  };
}

function initialPosition() { return parseFen(START_FEN); }

// Comprueba amenazas a una casilla, incluso las ejercidas por peones y reyes.
function isAttacked(position, target, bySide) {
  for (let from = 0; from < 128; from++) {
    if (!onBoard(from)) continue;
    const piece = position.board[from];
    if (pieceSide(piece) !== bySide) continue;
    const kind = piece.toLowerCase();

    if (kind === "p") {
      if (target === from - 16 * bySide - 1 || target === from - 16 * bySide + 1) return true;
      continue;
    }
    const dirs = kind === "q" ? ALL_DIRECTIONS : DIRECTIONS[kind];
    for (const direction of dirs) {
      for (let to = from + direction; onBoard(to); to += direction) {
        if (to === target) return true;
        if (position.board[to] !== "." || kind === "n" || kind === "k") break;
      }
    }
  }
  return false;
}

function isInCheck(position, side = position.turn) {
  const kingIndex = position.board.indexOf(side === 1 ? "K" : "k");
  return kingIndex < 0 || isAttacked(position, kingIndex, -side);
}

// Crea todas las jugadas candidatas, incluida la promoción automática a reina.
function pseudoMoves(position) {
  const moves = [];
  const board = position.board;
  const side = position.turn;
  const push = (from, to, flag = "") => {
    if (board[to].toLowerCase() === "k") return; // Nunca se captura al rey.
    const pawn = board[from].toLowerCase() === "p";
    const promo = pawn && ((to >> 4) === 0 || (to >> 4) === 7) ? "q" : "";
    moves.push({from, to, promo, flag});
  };

  for (let from = 0; from < 128; from++) {
    if (!onBoard(from) || pieceSide(board[from]) !== side) continue;
    const piece = board[from].toLowerCase();

    if (piece === "p") {
      const one = from - 16 * side;
      if (onBoard(one) && board[one] === ".") {
        push(from, one);
        const two = one - 16 * side;
        if ((from >> 4) === (side === 1 ? 6 : 1) && board[two] === ".") push(from, two);
      }
      for (const delta of [-1, 1]) {
        const to = one + delta;
        if (!onBoard(to)) continue;
        if (pieceSide(board[to]) === -side) push(from, to);
        else if (to === position.enPassant && board[to] === "." &&
          board[to + 16 * side] === (side === 1 ? "p" : "P")) push(from, to, "ep");
      }
      continue;
    }

    const dirs = piece === "q" ? ALL_DIRECTIONS : DIRECTIONS[piece];
    for (const direction of dirs) {
      for (let to = from + direction; onBoard(to); to += direction) {
        if (pieceSide(board[to]) === side) break;
        push(from, to);
        if (board[to] !== "." || piece === "n" || piece === "k") break;
      }
    }

    // Enroques: deben estar libres el camino y las casillas cruzadas por el rey.
    if (piece === "k") {
      const home = side === 1 ? 116 : 4;
      const rook = side === 1 ? "R" : "r";
      const kingside = side === 1 ? 1 : 4;
      const queenside = side === 1 ? 2 : 8;
      if (from !== home || isInCheck(position, side)) continue;
      if ((position.castle & kingside) && board[from + 3] === rook &&
          board[from + 1] === "." && board[from + 2] === "." &&
          !isAttacked(position, from + 1, -side) && !isAttacked(position, from + 2, -side)) {
        push(from, from + 2, "castle");
      }
      if ((position.castle & queenside) && board[from - 4] === rook &&
          board[from - 1] === "." && board[from - 2] === "." && board[from - 3] === "." &&
          !isAttacked(position, from - 1, -side) && !isAttacked(position, from - 2, -side)) {
        push(from, from - 2, "castle");
      }
    }
  }
  return moves;
}

// Produce una posición NUEVA, sin modificar la anterior.
function applyMove(position, move) {
  const {from, to, promo, flag} = move;
  const board = position.board.slice();
  const piece = board[from];
  const captured = board[to];
  let castle = position.castle;
  board[from] = ".";
  board[to] = promo ? (position.turn === 1 ? promo.toUpperCase() : promo) : piece;

  if (flag === "ep") board[to + 16 * position.turn] = ".";
  if (flag === "castle") {
    const rookFrom = to > from ? from + 3 : from - 4;
    const rookTo = to > from ? from + 1 : from - 1;
    board[rookTo] = board[rookFrom];
    board[rookFrom] = ".";
  }

  if (piece === "K") castle &= ~3;
  if (piece === "k") castle &= ~12;
  const rookBits = {119: 1, 112: 2, 7: 4, 0: 8};
  if (piece.toLowerCase() === "r") castle &= ~(rookBits[from] || 0);
  if (captured.toLowerCase() === "r") castle &= ~(rookBits[to] || 0);

  return {
    board,
    turn: -position.turn,
    castle,
    enPassant: piece.toLowerCase() === "p" && Math.abs(to - from) === 32 ? (to + from) / 2 : -1,
    halfmove: piece.toLowerCase() === "p" || captured !== "." || flag === "ep" ? 0 : position.halfmove + 1,
    fullmove: position.fullmove + (position.turn === -1 ? 1 : 0)
  };
}

// Filtra los movimientos que dejarían al propio rey en jaque.
function legalMoves(position) {
  return pseudoMoves(position).filter(move => !isInCheck(applyMove(position, move), position.turn));
}

function insufficientMaterial(position) {
  const nonKings = [];
  for (let i = 0; i < 128; i++) {
    if (!onBoard(i)) continue;
    const p = position.board[i].toLowerCase();
    if (p !== "." && p !== "k") nonKings.push({p, color: ((i >> 4) + (i & 7)) % 2});
  }
  return nonKings.length === 0 ||
    (nonKings.length === 1 && ["b", "n"].includes(nonKings[0].p)) ||
    (nonKings.length > 0 && nonKings.every(x => x.p === "b" && x.color === nonKings[0].color));
}

// Indica jaque, mate, ahogado y material insuficiente.
function getPositionResult(position) {
  const check = isInCheck(position);
  const options = legalMoves(position);
  if (!options.length) return {end: true, draw: !check, mate: check, check};
  if (insufficientMaterial(position)) return {end: true, draw: true, reason: "material insuficiente", check: false};
  return {end: false, check};
}

/* ========================  INTERFAZ  ======================== */
let game = null;
let setupWasRunning = false;
let clockLoopStarted = false;
const el = id => document.getElementById(id);

function makePreview() {
  const preview = el("preview-board");
  if (!preview) return;
  let position = initialPosition();
  for (const moveText of ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"]) {
    const move = legalMoves(position).find(m => toSquare(m.from) + toSquare(m.to) === moveText);
    if (move) position = applyMove(position, move);
  }
  const frag = document.createDocumentFragment();
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const piece = position.board[row * 16 + col];
    const cell = document.createElement("div");
    cell.className = `preview-square ${(row + col) % 2 ? "dark" : "light"}`;
    if (piece !== ".") {
      cell.textContent = GLYPHS[piece];
      cell.classList.add(pieceSide(piece) === 1 ? "preview-white" : "preview-black");
    }
    frag.append(cell);
  }
  preview.replaceChildren(frag);
}

function playerName(side) { return game.players[colorKey(side)]; }
function nameFor(color) { return game.players[color]; }
function formatTime(ms) {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(totalSeconds / 60).toString().padStart(2, "0")}:${(totalSeconds % 60).toString().padStart(2, "0")}`;
}

function renderClocks() {
  if (!game) return;
  for (const side of ["w", "b"]) {
    const element = el(`clock-${side === "w" ? "white" : "black"}`);
    const wrapper = el(`clock-box-${side === "w" ? "white" : "black"}`);
    element.textContent = game.clock.enabled ? formatTime(game.clock.remaining[side]) : "Sin reloj";
    wrapper.classList.toggle("no-clock", !game.clock.enabled);
    wrapper.classList.toggle("active", game.clock.enabled && game.clock.running && !game.over && colorKey(game.position.turn) === side);
    wrapper.classList.toggle("expired", game.clock.enabled && game.clock.remaining[side] <= 0);
  }
  el("pause-clock").disabled = !game.clock.enabled || game.over;
  el("pause-label").textContent = game.clock.running ? "Pausar reloj" : "Reanudar reloj";
  el("clock-help").textContent = !game.clock.enabled ? "Partida sin límite de tiempo." :
    game.over ? "El reloj se ha detenido: partida finalizada." :
    game.clock.running ? "El tiempo corre para quien tiene el turno." :
    "Reloj pausado: reanúdalo para continuar.";
}

// Resta tiempo real con performance.now, sin perder precisión entre intervalos.
function tickClock() {
  if (!game?.clock.enabled || !game.clock.running || game.over) return;
  const now = performance.now();
  const diff = Math.max(0, now - game.clock.lastTick);
  game.clock.lastTick = now;
  const color = colorKey(game.position.turn);
  game.clock.remaining[color] = Math.max(0, game.clock.remaining[color] - diff);
  if (game.clock.remaining[color] <= 0) {
    game.clock.running = false;
    game.over = true;
    const loser = nameFor(color);
    const winner = nameFor(color === "w" ? "b" : "w");
    game.announcement = `Se acabó el tiempo de ${loser}. ¡Gana ${winner}!`;
    renderStatus();
  }
  renderClocks();
}

function renderBoard() {
  const position = game?.position || initialPosition();
  const boardEl = el("chess-board");
  const targets = game?.options.filter(m => m.from === game.selected).map(m => m.to) || [];
  const inCheck = game ? isInCheck(position) : false;
  const fragment = document.createDocumentFragment();
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const i = row * 16 + col;
    const piece = position.board[i];
    const square = document.createElement("button");
    square.type = "button";
    square.className = `chess-square ${(row + col) % 2 ? "dark" : "light"}`;
    square.dataset.square = toSquare(i);
    const target = targets.includes(i);
    if (game?.lastMove.includes(i)) square.classList.add("last-move");
    if (game?.selected === i) square.classList.add("selected");
    if (target) square.classList.add(piece !== "." ? "capture-target" : "target");
    if (inCheck && piece.toLowerCase() === "k" && pieceSide(piece) === position.turn) square.classList.add("check");
    const who = piece !== "." ? `${PIECE_NAMES[piece.toLowerCase()]} ${pieceSide(piece) === 1 ? "blanco" : "negro"}` : "vacía";
    square.setAttribute("aria-label", `${toSquare(i)}: ${who}${target ? ", movimiento disponible" : ""}`);
    square.addEventListener("click", () => clickSquare(i));
    if (piece !== ".") {
      const symbol = document.createElement("span");
      symbol.className = `chess-piece ${pieceSide(piece) === 1 ? "white" : "black"}`;
      symbol.textContent = GLYPHS[piece];
      symbol.setAttribute("aria-hidden", "true");
      square.append(symbol);
    }
    if (col === 0) {
      const label = document.createElement("span"); label.className = "coord rank";
      label.textContent = String(8 - row); square.append(label);
    }
    if (row === 7) {
      const label = document.createElement("span"); label.className = "coord file";
      label.textContent = FILES[col]; square.append(label);
    }
    fragment.append(square);
  }
  boardEl.replaceChildren(fragment);
}

function renderStatus() {
  if (!game) return;
  const side = game.position.turn;
  const color = colorKey(side);
  let title = game.over ? "Partida terminada" : `Turno de ${nameFor(color)}`;
  const description = game.announcement || (game.clock.enabled && !game.clock.running ?
    "Reloj en pausa. Reanúdalo para mover." : "Selecciona una pieza para ver sus movimientos.");
  el("turn-heading").textContent = title;
  el("game-message").textContent = description;
  el("turn-color").textContent = side === 1 ? "Blancas" : "Negras";
  el("turn-color").classList.toggle("black-turn", side === -1);
  el("white-player").textContent = game.players.w;
  el("black-player").textContent = game.players.b;
  el("capturer-white").textContent = game.players.w;
  el("capturer-black").textContent = game.players.b;
}

function renderCaptured() {
  for (const color of ["w", "b"]) {
    const key = color === "w" ? "white" : "black";
    const list = el(`captured-${key}`);
    const captures = game.captures[color];
    el(`capture-count-${key}`).textContent = String(captures.length);
    list.replaceChildren();
    if (!captures.length) { list.textContent = "Ninguna todavía"; continue; }
    for (const piece of captures) {
      const symbol = document.createElement("span");
      symbol.textContent = GLYPHS[piece];
      symbol.className = `captured-glyph ${pieceSide(piece) === 1 ? "white" : "black"}`;
      symbol.setAttribute("aria-label", PIECE_NAMES[piece.toLowerCase()]);
      list.append(symbol);
    }
  }
}

function renderHistory() {
  const list = el("move-history");
  list.replaceChildren();
  if (!game.history.length) {
    const empty = document.createElement("li"); empty.className = "empty-history";
    empty.textContent = "Aún no hay movimientos."; list.append(empty); return;
  }
  game.history.slice(-8).forEach(entry => {
    const item = document.createElement("li");
    const n = document.createElement("span"); n.className = "move-number";
    n.textContent = entry.number;
    const text = document.createElement("span"); text.textContent = entry.text;
    item.append(n, text); list.append(item);
  });
  list.scrollTop = list.scrollHeight;
}

function renderEverything() { renderBoard(); renderStatus(); renderClocks(); renderCaptured(); renderHistory(); }

function clickSquare(index) {
  if (!game || game.over || (game.clock.enabled && !game.clock.running)) return;
  // Asegura que el jugador no mueva después de agotar su tiempo entre ticks.
  tickClock();
  if (game.over) return;
  const piece = game.position.board[index];
  if (game.selected !== -1) {
    const chosen = game.options.find(m => m.from === game.selected && m.to === index);
    if (chosen) { play(chosen); return; }
  }
  if (pieceSide(piece) === game.position.turn) {
    game.selected = game.selected === index ? -1 : index;
    game.options = legalMoves(game.position);
    game.announcement = game.selected === -1 ? "Selecciona una pieza para ver sus movimientos." :
      game.options.some(m => m.from === index) ? "Selecciona una casilla resaltada para mover." :
      "Esa pieza no tiene movimientos legales en este momento.";
  } else {
    game.selected = -1;
    game.announcement = isInCheck(game.position) ? "Tu rey está en jaque. Debes defenderlo." :
      "Selecciona una pieza de tu color.";
  }
  renderBoard(); renderStatus();
}

function play(move) {
  const before = game.position;
  const piece = before.board[move.from];
  const captured = move.flag === "ep" ? before.board[move.to + 16 * before.turn] : before.board[move.to];
  if (captured !== ".") game.captures[colorKey(before.turn)].push(captured);
  const notation = move.flag === "castle" ? (move.to > move.from ? "O-O" : "O-O-O") :
    `${toSquare(move.from)}${captured === "." ? "–" : "×"}${toSquare(move.to)}${move.promo ? "=♛" : ""}`;
  game.position = applyMove(before, move);
  const outcome = getPositionResult(game.position);
  let suffix = outcome.mate ? " #" : outcome.check ? " +" : "";
  game.history.push({number: before.fullmove + (before.turn === 1 ? "." : "…"), text: notation + suffix});
  game.lastMove = [move.from, move.to];
  game.selected = -1;
  game.options = [];

  if (outcome.end) {
    game.over = true;
    game.clock.running = false;
    game.announcement = outcome.mate ? `¡Jaque mate! Gana ${playerName(before.turn)}.` :
      outcome.reason ? `Tablas por ${outcome.reason}.` : "Tablas por ahogado: no hay jugadas legales.";
  } else {
    game.announcement = outcome.check ?
      `¡Jaque a ${playerName(game.position.turn)}! Debe proteger su rey.` :
      `Le toca mover a ${playerName(game.position.turn)}.`;
    if (game.clock.enabled) game.clock.lastTick = performance.now();
  }
  renderEverything();
}

function startGame(white, black, timerEnabled, minutes) {
  const ms = minutes * 60 * 1000;
  game = {
    position: initialPosition(), players: {w: white, b: black},
    captures: {w: [], b: []}, selected: -1, options: [], lastMove: [], history: [],
    over: false, announcement: `${white} juega primero con las piezas blancas.`,
    clock: {enabled: timerEnabled, remaining: {w: ms, b: ms}, running: timerEnabled, lastTick: performance.now()}
  };
  document.title = `${white} vs. ${black} | Enroque`;
  if (!clockLoopStarted) { setInterval(tickClock, 150); clockLoopStarted = true; }
  renderEverything();
}

// El diálogo se muestra al empezar y al pedir una nueva partida.
function openSetup() {
  const modal = el("setup-dialog");
  setupWasRunning = !!game?.clock.running;
  if (game) { tickClock(); game.clock.running = false; renderClocks(); }
  el("setup-form").reset();
  el("enable-clock").checked = false;
  syncTimeSelector();
  el("setup-error").hidden = true;
  el("setup-cancel").hidden = !game;
  modal.showModal();
  el("name-white").focus();
}

function closeSetup() {
  if (!game) return;
  el("setup-dialog").close();
  if (game.clock.enabled && !game.over && setupWasRunning) {
    game.clock.lastTick = performance.now();
    game.clock.running = true;
  }
  renderStatus(); renderClocks();
}

function syncTimeSelector() {
  const active = el("enable-clock").checked;
  el("time-choice").disabled = !active;
  el("time-selector").classList.toggle("is-disabled", !active);
}

function initGamePage() {
  if (!el("chess-board")) return;
  renderBoard();
  el("enable-clock").addEventListener("change", syncTimeSelector);
  el("setup-form").addEventListener("submit", event => {
    event.preventDefault();
    const white = el("name-white").value.trim();
    const black = el("name-black").value.trim();
    if (!white || !black) { el("setup-error").textContent = "Escribe los dos nombres para continuar."; el("setup-error").hidden = false; return; }
    if (white.toLocaleLowerCase() === black.toLocaleLowerCase()) {
      el("setup-error").textContent = "Elige nombres diferentes para reconocer los turnos.";
      el("setup-error").hidden = false; return;
    }
    const enabled = el("enable-clock").checked;
    const minutes = Number(el("time-choice").value);
    el("setup-dialog").close();
    startGame(white, black, enabled, minutes);
  });
  el("new-game").addEventListener("click", openSetup);
  el("new-game-nav").addEventListener("click", openSetup);
  el("setup-cancel").addEventListener("click", closeSetup);
  el("setup-dialog").addEventListener("cancel", event => {
    event.preventDefault();
    closeSetup();
  });
  el("pause-clock").addEventListener("click", () => {
    if (!game?.clock.enabled || game.over) return;
    if (game.clock.running) { tickClock(); game.clock.running = false; }
    else { game.clock.running = true; game.clock.lastTick = performance.now(); }
    game.announcement = game.clock.running ? `Le toca mover a ${playerName(game.position.turn)}.` :
      "Reloj en pausa. Reanúdalo para continuar la partida.";
    renderStatus(); renderClocks();
  });
  openSetup();
}

document.addEventListener("DOMContentLoaded", () => {
  makePreview();
  initGamePage();
});
