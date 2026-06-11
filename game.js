(function () {
  "use strict";

  const EMPTY = 0;
  const BLACK = 1;
  const WHITE = 2;
  const SIZE = 8;

  const DIRECTIONS = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1],
  ];

  const CORNER_WEIGHT = 120;
  const EDGE_WEIGHT = 8;
  const MOBILITY_WEIGHT = 6;
  const CPU_DELAY_MS = 600; 

  const boardEl = document.getElementById("board");
  const boardWrapEl = document.querySelector(".board-wrap");
  const gameAreaEl = document.getElementById("game-area");
  const messageEl = document.getElementById("message");
  const countBlackEl = document.getElementById("count-black");
  const countWhiteEl = document.getElementById("count-white");
  const turnTextEl = document.getElementById("turn-text");
  const turnDiscEl = document.getElementById("turn-disc");
  const cardBlackEl = document.getElementById("card-black");
  const cardWhiteEl = document.getElementById("card-white");
  const labelBlackEl = document.getElementById("label-black");
  const labelWhiteEl = document.getElementById("label-white");
  const subtitleEl = document.getElementById("subtitle");
  const setupModalEl = document.getElementById("modal-setup");
  const setupFormEl = document.getElementById("setup-form");
  const onlinePassphraseEl = document.getElementById("online-passphrase");
  const passphraseInput = document.getElementById("setup-passphrase");
  const colorLegendEl = document.getElementById("color-legend");
  const colorHintEl = document.getElementById("color-hint");
  const gameoverModalEl = document.getElementById("modal-gameover");
  const modalBodyEl = document.getElementById("modal-body");
  const gameoverBannerEl = document.getElementById("gameover-banner");
  const gameoverHeadlineEl = document.getElementById("gameover-headline");

  const charZoneEl = document.getElementById("char-zone");
  const charAvatarEl = document.getElementById("char-avatar");
  const charNameEl = document.getElementById("char-name");
  const charTitleEl = document.getElementById("char-title");
  const charLineEl = document.getElementById("char-line");

  const SUPABASE_URL = "https://iclfzueezuwsfoxibmww.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_SThaSyCH5PIWMr-X5SkeCA_kiYBMz_3";

  let board;
  let currentPlayer;
  let validMoves;
  let gameOver;
  let hintVisible = false; 
  let speechEnabled = true;
  let vsCpu;
  let cpuLevel; 
  let humanColor;
  let cpuColor;
  let cpuThinking;
  let isTransitioning = false; 
  let myColor = null;
  let opponentColor = null;
  let networked = false;
  let supabaseClient = null;
  let onlineChannel = null;
  let clientId = null;
  let colorChoices = {};
  let room = null;
  const BEST_SCORE_STORAGE = "reversi_best_scores";
  let bestScores = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  let CPU_CHARACTERS = {};

  // サウンド再生用
  let placementSound = null;

  function initPlacementSound() {
    if (!placementSound) {
      placementSound = new Audio('./pashhi.mp3');
      placementSound.volume = 0.5;
    }
  }

  function playPlacementSound() {
    initPlacementSound();
    if (placementSound) {
      placementSound.currentTime = 0;
      placementSound.play().catch(err => {
        // 自動再生がブロックされている可能性があるため、エラーは無視
        console.debug('音声再生スキップ:', err);
      });
    }
  }

  async function loadCharacters() {
    try {
      const res = await fetch("characters.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("failed to load characters.json");
      CPU_CHARACTERS = await res.json();
    } catch (e) {
      console.error("キャラクター情報の読み込みに失敗しました", e);
      CPU_CHARACTERS = {};
    }
  }

  function getCharacter(level) {
    return CPU_CHARACTERS[String(level)] || null;
  }

  function randomFrom(list) {
    if (!Array.isArray(list) || list.length === 0) return "";
    return list[Math.floor(Math.random() * list.length)];
  }

  function createBoard() {
    board = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
    const mid = SIZE / 2;
    board[mid - 1][mid - 1] = WHITE;
    board[mid - 1][mid] = BLACK;
    board[mid][mid - 1] = BLACK;
    board[mid][mid] = WHITE;
  }

  function cloneBoard(src) {
    return src.map((row) => row.slice());
  }

  function inBounds(row, col) {
    return row >= 0 && row < SIZE && col >= 0 && col < SIZE;
  }

  function opponent(player) {
    return player === BLACK ? WHITE : BLACK;
  }

  function getFlipsOn(boardState, row, col, player) {
    if (boardState[row][col] !== EMPTY) return [];

    const flips = [];
    for (const [dr, dc] of DIRECTIONS) {
      const line = [];
      let r = row + dr;
      let c = col + dc;

      while (inBounds(r, c) && boardState[r][c] === opponent(player)) {
        line.push([r, c]);
        r += dr;
        c += dc;
      }

      if (line.length > 0 && inBounds(r, c) && boardState[r][c] === player) {
        flips.push(...line);
      }
    }
    return flips;
  }

  function computeValidMovesOn(boardState, player) {
    const moves = new Map();
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const flips = getFlipsOn(boardState, r, c, player);
        if (flips.length > 0) {
          moves.set(`${r},${c}`, flips);
        }
      }
    }
    return moves;
  }

  function applyMoveOn(boardState, row, col, player, flips) {
    const next = cloneBoard(boardState);
    next[row][col] = player;
    for (const [fr, fc] of flips) {
      next[fr][fc] = player;
    }
    return next;
  }

  function countPiecesOn(boardState) {
    let black = 0;
    let white = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (boardState[r][c] === BLACK) black++;
        else if (boardState[r][c] === WHITE) white++;
      }
    }
    return { black, white };
  }

  function countPieces() {
    if (!board) return { black: 2, white: 2 };
    return countPiecesOn(board);
  }

  function hideGameoverBanner() {
    if (!gameoverBannerEl) return;
    gameoverBannerEl.hidden = true;
    gameoverBannerEl.classList.remove("is-visible", "gameover-banner--black", "gameover-banner--white", "gameover-banner--draw");
  }

  function showGameoverBanner(headline, tone) {
    if (!gameoverBannerEl || !gameoverHeadlineEl) return;
    gameoverHeadlineEl.textContent = headline;
    gameoverBannerEl.classList.remove("gameover-banner--black", "gameover-banner--white", "gameover-banner--draw");
    gameoverBannerEl.classList.add(`gameover-banner--${tone}`);
    gameoverBannerEl.hidden = false;

    window.requestAnimationFrame(() => {
      gameoverBannerEl.classList.add("is-visible");
    });
  }

  function loadBestScores() {
    try {
      const saved = localStorage.getItem(BEST_SCORE_STORAGE);
      if (saved) {
        const parsed = JSON.parse(saved);
        for (let level = 1; level <= 5; level++) {
          if (typeof parsed[level] === "number" && Number.isFinite(parsed[level]) && parsed[level] >= 0) {
            bestScores[level] = parsed[level];
          }
        }
      }
    } catch (error) {
      bestScores = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    }
  }

  function toggleHint() {
    hintVisible = !hintVisible;
    updateHintButtonText();
    renderBoard();
  }

  function saveBestScores() {
    localStorage.setItem(BEST_SCORE_STORAGE, JSON.stringify(bestScores));
  }

  function formatBestScore(value) {
    return value > 0 ? `${value}` : "—";
  }

  function updateBestScoresTable(containerId = "best-scores-body") {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";

    const tr = document.createElement("tr");

    for (let level = 1; level <= 5; level++) {
      const td = document.createElement("td");
      td.textContent = formatBestScore(bestScores[level]);
      
      if (vsCpu && cpuLevel === level && gameOver) {
        td.classList.add("updated");
      }
      tr.appendChild(td);
    }

    container.appendChild(tr);
  }

  function clearBestScores() {
    for (let i = 1; i <= 5; i++) bestScores[i] = 0;
    saveBestScores();
    updateBestScoresTable('best-scores-body');
    updateBestScoresTable('best-scores-body-popup');
  }

  function openBestScoresWindow() {
    const modal = document.getElementById('modal-best-scores');
    if (!modal) return;
    loadBestScores();
    updateBestScoresTable('best-scores-body-popup');
    try { modal.showModal(); } catch(e) { modal.setAttribute('open', ''); }

    const btnClear = document.getElementById('btn-clear-best-scores');
    const btnBack = document.getElementById('btn-back-best-scores');
    
    if (btnClear) {
      const newClear = btnClear.cloneNode(true);
      btnClear.parentNode.replaceChild(newClear, btnClear);
      
      const runClear = (e) => {
        e.preventDefault();
        if (confirm('ベストスコアを全てクリアしますか？')) {
          clearBestScores();
        }
      };
      newClear.addEventListener('touchend', runClear, { passive: false });
      newClear.addEventListener('click', runClear);
    }

    if (btnBack) {
      const newBack = btnBack.cloneNode(true);
      btnBack.parentNode.replaceChild(newBack, btnBack);
      
      const runBack = (e) => {
        e.preventDefault();
        try { modal.close(); } catch(err) { modal.removeAttribute('open'); }
      };
      newBack.addEventListener('touchend', runBack, { passive: false });
      newBack.addEventListener('click', runBack);
    }
  }

  function updateBestScoreIfNeeded(points) {
    if (!vsCpu || !cpuLevel || cpuLevel < 1 || cpuLevel > 5) return false;
    const level = cpuLevel;
    if (points > bestScores[level]) {
      bestScores[level] = points;
      saveBestScores();
      return true;
    }
    return false;
  }

  function colorName(player) {
    return player === BLACK ? "黒" : "白";
  }

  function levelName(level) {
    const ch = getCharacter(level);
    if (!ch) return `（Lv${level}:CPU）`;
    return `（Lv${level}:${ch.name}）`;
  }

  function levelDescription(level) {
    const lvl = parseInt(level, 10);
    const ch = getCharacter(lvl);
    if (!ch) {
      if (lvl === 1) return "Lv1:初心者";
      if (lvl === 2) return "Lv2:中級";
      if (lvl === 3) return "Lv3:上級";
      if (lvl === 4) return "Lv4:達人";
      return "Lv5:CPU";
    }
    return `Lv${lvl}:${ch.title}`;
  }

  function updateCpuLevelLabel(level) {
    const labelEl = document.getElementById('setup-level-label');
    if (labelEl) {
      labelEl.textContent = levelDescription(level);
    }
  }

  function roleFor(player) {
    if (vsCpu) {
      if (player === humanColor) return "（あなた）";
      return levelName(cpuLevel);
    }
    if (networked) {
      if (player === myColor) return "（あなた）";
      return "（相手）";
    }
    return "";
  }

  function updatePlayerLabels() {
    if (labelBlackEl) labelBlackEl.textContent = `黒${roleFor(BLACK)}`;
    if (labelWhiteEl) labelWhiteEl.textContent = `白${roleFor(WHITE)}`;
    
    let modeText = "CPU対戦";
    if (vsCpu) {
      const ch = getCharacter(cpuLevel);
      modeText = `CPU対戦 (${ch?.name || ""})`;
    } else if (networked) {
      modeText = "オンライン対戦";
    }
    if (subtitleEl) subtitleEl.textContent = `${modeText} — 黒が先手`;

    if (cardBlackEl) cardBlackEl.classList.toggle("is-you", (vsCpu && humanColor === BLACK) || (networked && myColor === BLACK));
    if (cardWhiteEl) cardWhiteEl.classList.toggle("is-you", (vsCpu && humanColor === WHITE) || (networked && myColor === WHITE));
  }

  function turnLabel() {
    if (gameOver) return "終了";
    if (vsCpu) {
      if (currentPlayer === humanColor) return "あなたの番";
      return "相手の番 ";
    }
    if (networked) {
      return currentPlayer === myColor ? "あなたの番" : "相手の番 ";
    }
    return "";
  }

  function isCpuTurn() {
    return vsCpu && currentPlayer === cpuColor;
  }

  function updateScoreboard() {
    const { black, white } = countPieces();
    if (countBlackEl) countBlackEl.textContent = black;
    if (countWhiteEl) countWhiteEl.textContent = white;

    if (cardBlackEl) cardBlackEl.classList.toggle("active", !gameOver && currentPlayer === BLACK);
    if (cardWhiteEl) cardWhiteEl.classList.toggle("active", !gameOver && currentPlayer === WHITE);

    if (turnTextEl) turnTextEl.textContent = turnLabel();
    if (turnDiscEl) turnDiscEl.className = `turn-disc disc--${currentPlayer === BLACK ? "black" : "white"}`;
  }

  function updateCharacterSpeech(type, context = {}) {
    if (!speechEnabled || !vsCpu || !charZoneEl) {
      if (charZoneEl) charZoneEl.classList.add("char-zone--hidden");
      return;
    }

    const ch = getCharacter(cpuLevel);
    if (!ch) return;

    if (charAvatarEl && charAvatarEl.tagName === "IMG") {
      if (ch.avatarUrl) {
        charAvatarEl.src = ch.avatarUrl;
        charAvatarEl.alt = ch.name || "キャラクター";
      }
    }
    if (charNameEl) charNameEl.textContent = ch.name || "";
    if (charTitleEl) charTitleEl.textContent = ch.title || "";

    const lines = ch.lines || {};
    let line = "";

    if (type === "start") {
      line = randomFrom(lines.start);
    } else if (type === "turn_eval") {
      const { margin } = context; 
      const abs = Math.abs(margin);
      
      if (margin > 8) line = randomFrom(lines.behind_big);
      else if (margin > 0) line = randomFrom(lines.behind_close);
      else if (margin === 0) line = randomFrom(lines.even);
      else if (margin < -8) line = randomFrom(lines.lead_big);
      else line = randomFrom(lines.lead_close);
    } else if (type === "win") {
      line = Math.abs(context.margin ?? 0) >= 10 ? randomFrom(lines.win_big) : randomFrom(lines.win_close);
    } else if (type === "lose") {
      line = Math.abs(context.margin ?? 0) >= 10 ? randomFrom(lines.lose_big) : randomFrom(lines.lose_close);
    } else if (type === "draw") {
      line = randomFrom(lines.draw);
    }

    if (charLineEl && line) charLineEl.textContent = `「${line}」`;
    charZoneEl.classList.remove("char-zone--hidden");
  }

  function renderBoard(animateFlips) {
    if (!boardEl) return;
    boardEl.innerHTML = "";
    
    if (!board) createBoard(); 

    const isHumanTurn = !gameOver && ((vsCpu && currentPlayer === humanColor) || (networked && currentPlayer === myColor) || (!vsCpu && !networked));

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "cell";
        cell.setAttribute("role", "gridcell");
        cell.setAttribute("aria-label", `マス ${r + 1}行 ${c + 1}列`);

        const key = `${r},${c}`;
        const isValid = validMoves ? validMoves.has(key) : false;

        if (isValid && !gameOver && isHumanTurn && hintVisible) {
          cell.classList.add("valid");
          cell.classList.add("show-hint");
        }

        const piece = board[r][c];
        if (piece !== EMPTY) {
          const disc = document.createElement("span");
          disc.className = `piece ${piece === BLACK ? "black" : "white"}`;
          if (animateFlips && animateFlips.has(key)) {
            disc.classList.add("flip");
          }
          cell.appendChild(disc);
        }

        if (isHumanTurn && isValid) {
          const handleCellClick = () => makeMove(r, c);
          cell.addEventListener("click", handleCellClick);
          cell.addEventListener("touchend", handleCellClick);
        }

        boardEl.appendChild(cell);
      }
    }
  }

  function evaluateBoard(boardState, player) {
    const corners = [
      [0, 0], [0, SIZE - 1], [SIZE - 1, 0], [SIZE - 1, SIZE - 1],
    ];
    let score = 0;
    const { black, white } = countPiecesOn(boardState);
    const myCount = player === BLACK ? black : white;
    const oppCount = player === BLACK ? white : black;

    for (const [r, c] of corners) {
      if (boardState[r][c] === player) score += CORNER_WEIGHT;
      else if (boardState[r][c] === opponent(player)) score -= CORNER_WEIGHT;
    }

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const onEdge = r === 0 || r === SIZE - 1 || c === 0 || c === SIZE - 1;
        if (!onEdge) continue;
        const isCorner = (r === 0 || r === SIZE - 1) && (c === 0 || c === SIZE - 1);
        if (isCorner) continue;
        if (boardState[r][c] === player) score += EDGE_WEIGHT;
        else if (boardState[r][c] === opponent(player)) score -= EDGE_WEIGHT;
      }
    }

    const myMoves = computeValidMovesOn(boardState, player).size;
    const oppMoves = computeValidMovesOn(boardState, opponent(player)).size;
    score += (myMoves - oppMoves) * MOBILITY_WEIGHT;

    const empty = SIZE * SIZE - black - white;
    if (empty <= 10) {
      score += (myCount - oppCount) * 2;
    }

    return score;
  }

  function minimax(boardState, depth, alpha, beta, player, maximizingPlayer) {
    const moves = computeValidMovesOn(boardState, player);
    if (depth === 0 || moves.size === 0) {
      const terminal = moves.size === 0;
      if (terminal) {
        const passMoves = computeValidMovesOn(boardState, opponent(player));
        if (passMoves.size > 0) {
          return minimax(boardState, depth, alpha, beta, opponent(player), maximizingPlayer);
        }
        const { black, white } = countPiecesOn(boardState);
        const my = maximizingPlayer === BLACK ? black : white;
        const opp = maximizingPlayer === BLACK ? white : black;
        if (my > opp) return 100000 + my - opp;
        if (my < opp) return -100000 + my - opp;
        return 0;
      }
      return evaluateBoard(boardState, maximizingPlayer);
    }

    if (player === maximizingPlayer) {
      let maxEval = -Infinity;
      for (const [key, flips] of moves) {
        const [r, c] = key.split(",").map(Number);
        const next = applyMoveOn(boardState, r, c, player, flips);
        const evalScore = minimax(
          next,
          depth - 1,
          alpha,
          beta,
          opponent(player),
          maximizingPlayer
        );
        maxEval = Math.max(maxEval, evalScore);
        alpha = Math.max(alpha, evalScore);
        if (beta <= alpha) break;
      }
      return maxEval;
    }

    let minEval = Infinity;
    for (const [key, flips] of moves) {
      const [r, c] = key.split(",").map(Number);
      const next = applyMoveOn(boardState, r, c, player, flips);
      const evalScore = minimax(
        next,
        depth - 1,
        -Infinity,
        Infinity,
        opponent(player),
        maximizingPlayer
      );
      minEval = Math.min(minEval, evalScore);
      beta = Math.min(beta, evalScore);
      if (beta <= alpha) break;
    }
    return minEval;
  }

  function chooseCpuMove() {
    const moves = computeValidMovesOn(board, cpuColor);
    if (moves.size === 0) return null;

    let depth = 5;
    if (cpuLevel === 1) depth = 1;
    else if (cpuLevel === 2) depth = 2;
    else if (cpuLevel === 3) depth = 3;
    else if (cpuLevel === 4) depth = 4;

    let bestScore = (cpuLevel === 1) ? Infinity : -Infinity;
    let selectedKeys = [];

    for (const [key, flips] of moves) {
      const [r, c] = key.split(",").map(Number);
      const next = applyMoveOn(board, r, c, cpuColor, flips);
      const score = minimax(
        next,
        depth - 1,
        -Infinity,
        Infinity,
        opponent(cpuColor),
        cpuColor
      );

      if (cpuLevel === 1) {
        if (score < bestScore) {
          bestScore = score;
          selectedKeys = [key];
        } else if (score === bestScore) {
          selectedKeys.push(key);
        }
      } else {
        if (score > bestScore) {
          bestScore = score;
          selectedKeys = [key];
        } else if (score === bestScore) {
          selectedKeys.push(key);
        }
      }
    }

    const pick = selectedKeys[Math.floor(Math.random() * selectedKeys.length)];
    const [row, col] = pick.split(",").map(Number);
    return [row, col];
  }

  function scheduleCpuTurn() {
    if (!isCpuTurn() || gameOver || cpuThinking) return;

    cpuThinking = true;

    window.setTimeout(() => {
      if (gameOver || !isCpuTurn()) {
        cpuThinking = false;
        return;
      }
      const move = chooseCpuMove();
      if (move) {
        const key = `${move[0]},${move[1]}`;
        const flips = computeValidMovesOn(board, cpuColor).get(key);
        
        board[move[0]][move[1]] = cpuColor;
        const flippedKeys = new Set();
        if (flips) {
          for (const [fr, fc] of flips) {
            board[fr][fc] = cpuColor;
            flippedKeys.add(`${fr},${fc}`);
          }
        }
        
        endTurn(flippedKeys);
      }
      cpuThinking = false;
    }, CPU_DELAY_MS);
  }

  function makeMove(row, col) {
    const key = `${row},${col}`;
    const flips = validMoves ? validMoves.get(key) : null;
    
    if (!flips || gameOver || isCpuTurn() || isTransitioning) return;

    isTransitioning = true;
    validMoves = new Map();

    board[row][col] = currentPlayer;
    const flippedKeys = new Set();
    for (const [fr, fc] of flips) {
      board[fr][fc] = currentPlayer;
      flippedKeys.add(`${fr},${fc}`);
    }

    if (messageEl) messageEl.textContent = "";

    if (networked && currentPlayer !== myColor) {
      isTransitioning = false;
      return;
    }

    if (networked && onlineChannel) {
      try {
        onlineChannel.send({
          type: 'broadcast',
          event: 'move',
          payload: {
            clientId,
            row,
            col,
            color: currentPlayer === BLACK ? 'black' : 'white'
          }
        });
      } catch (e) {
        console.error("Failed to broadcast move:", e);
      }
    }

    endTurn(flippedKeys);
  }

  function passMessage(passedPlayer) {
    if (!vsCpu) {
      return `${colorName(passedPlayer)}は置けないためパス。${colorName(currentPlayer)}の番です`;
    }
    if (passedPlayer === cpuColor) {
      const ch = getCharacter(cpuLevel);
      const name = ch?.name || "CPU";
      return `${name}は置けないためパス。あなたの番です`;
    }
    return "あなたは置けないためパス。CPUの番です";
  }

  function updateHintButtonText() {
    const btnHint = document.getElementById("btn-hint");
    if (btnHint) {
      btnHint.textContent = hintVisible ? "ヒントを隠す" : "置ける場所を表示";
    }
  }

  function endTurn(animateFlips) {
    playPlacementSound();
    renderBoard(animateFlips);
    updateScoreboard();

    if (!gameOver) {
      const { black, white } = countPieces();
      const margin = (humanColor === BLACK) ? (black - white) : (white - black);
      updateCharacterSpeech("turn_eval", { margin });
    }

    window.setTimeout(() => {
      const next = opponent(currentPlayer);
      const nextMoves = computeValidMovesOn(board, next);

      if (nextMoves.size > 0) {
        currentPlayer = next;
        validMoves = nextMoves;
        gameOver = false;
        renderBoard(); 
        updateScoreboard();
        
        isTransitioning = false; 
        scheduleCpuTurn();
        return;
      }

      const passMoves = computeValidMovesOn(board, currentPlayer);
      if (passMoves.size > 0) {
        currentPlayer = next; 
        validMoves = new Map(); 
        if (messageEl) messageEl.textContent = passMessage(next);
        
        renderBoard();
        updateScoreboard();

        window.setTimeout(() => {
          if (gameOver) {
            isTransitioning = false;
            return;
          }
          currentPlayer = opponent(next); 
          validMoves = passMoves;          
          if (messageEl) messageEl.textContent = "";     
          renderBoard();
          updateScoreboard();
          
          isTransitioning = false; 
          scheduleCpuTurn(); 
        }, 1500);
        
        return;
      }

      isTransitioning = false; 
      finishGame();
    }, 400); 
  }

  function resultMessage(black, white) {
    if (!vsCpu) {
      if (black > white) return `黒の勝ち！（${black} vs ${white}）`;
      if (white > black) return `白の勝ち！（${black} vs ${white}）`;
      return `引き分け！（${black} vs ${white}）`;
    }

    const humanCount = humanColor === BLACK ? black : white;
    const cpuCount = humanColor === BLACK ? white : black;
    if (humanCount > cpuCount) {
      return `あなたの勝ち！（${humanCount} vs ${cpuCount}）`;
    }
    if (humanCount < cpuCount) {
      const ch = getCharacter(cpuLevel);
      const name = ch?.name || "CPU";
      return `${name}の勝ち！（${humanCount} vs ${cpuCount}）`;
    }
    return `引き分け！（${humanCount} vs ${cpuCount}）`;
  }

  function finishGame() {
    gameOver = true;
    cpuThinking = false;
    validMoves = new Map();
    renderBoard();
    updateScoreboard();

    const { black, white } = countPieces();
    const result = resultMessage(black, white);
    const headline = black > white ? "黒の勝ち" : white > black ? "白の勝ち" : "引き分け";
    const tone = black > white ? "black" : white > black ? "white" : "draw";
    
    const humanCount = vsCpu ? (humanColor === BLACK ? black : white) : null;
    const cpuCount = vsCpu ? (humanColor === BLACK ? white : black) : null;
    const recordUpdated = vsCpu && humanCount !== null && updateBestScoreIfNeeded(humanCount);

    if (vsCpu && humanCount !== null && cpuCount !== null) {
      const margin = humanCount - cpuCount;
      if (humanCount > cpuCount) updateCharacterSpeech("win", { margin });
      else if (humanCount < cpuCount) updateCharacterSpeech("lose", { margin });
      else updateCharacterSpeech("draw");
    }

    if (turnTextEl) turnTextEl.textContent = "終了";
    if (messageEl) messageEl.textContent = result;
    const scoreText = `${black} vs ${white}`;
    if (modalBodyEl) {
      modalBodyEl.innerHTML = `
        <div class="modal-score">${scoreText}</div>
        ${recordUpdated ? '<div class="best-score-badge">New Record!</div>' : ''}
      `;
    }
    
    loadBestScores();
    updateBestScoresTable('best-scores-body');
    updateBestScoresTable('best-scores-body-popup');

    showGameoverBanner(headline, tone);
  }

  function startGame(config) {
    vsCpu = config.mode === "cpu";
    cpuLevel = parseInt(config.level, 10);
    cpuColor = null;
    myColor = null;
    opponentColor = null;

    if (vsCpu) {
      humanColor = config.color === "black" ? BLACK : WHITE;
      myColor = humanColor;
      cpuColor = opponent(humanColor);
    } else if (networked) {
      myColor = config.color === "black" ? BLACK : WHITE;
      opponentColor = opponent(myColor);
      humanColor = null;
    } else {
      humanColor = null;
    }

    createBoard();
    currentPlayer = BLACK;
    validMoves = computeValidMovesOn(board, BLACK);
    gameOver = false;
    hintVisible = config.hintInit; 
    speechEnabled = config.speechEnabled;
    cpuThinking = false;
    isTransitioning = false;
    if (messageEl) messageEl.textContent = "";

    hideGameoverBanner();
    updatePlayerLabels();
    updateHintButtonText(); 
    
    updateCharacterSpeech("start");

    if (gameAreaEl) {
      gameAreaEl.classList.remove("game-area--hidden");
      gameAreaEl.style.display = "block";
    }

    if (setupModalEl) {
      try { setupModalEl.close(); } catch(e){}
    } 
    renderBoard();
    updateScoreboard();
    scheduleCpuTurn();

    // ▼▼▼ 追加：対局開始時の自動スクロール処理 ▼▼▼
    // モーダルが閉じて配置が確定した後に実行するため、少し遅延を入れます
    setTimeout(() => {
      if (charZoneEl && !charZoneEl.classList.contains("char-zone--hidden")) {
        // CPU対戦：キャラのセリフ枠の上部を画面最上部に合わせる
        charZoneEl.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (gameAreaEl) {
        // オンライン対戦（キャラ非表示）：盤面（gameAreaEl）の上部を画面最上部に合わせる
        gameAreaEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 100);
    // ▲▲▲ 追加ここまで ▲▲▲
  }

  function showSetup() {
    gameOver = true;
    cpuThinking = false;
    if (onlineChannel) {
      try { onlineChannel.unsubscribe(); } catch(e){}
      onlineChannel = null;
    }
    networked = false;
    myColor = null;
    opponentColor = null;
    room = null;

    const onlineModalEl = document.getElementById('modal-online-color');
    if (onlineModalEl && onlineModalEl.open) {
      try { onlineModalEl.close(); } catch(e){}
    }

    if (charZoneEl) charZoneEl.classList.add("char-zone--hidden");

    if (gameAreaEl) {
      gameAreaEl.classList.add("game-area--hidden");
    }

    if (gameoverModalEl && gameoverModalEl.open) {
      try { gameoverModalEl.close(); } catch(e){}
    }
    hideGameoverBanner();
    loadBestScores();
    updateBestScoresTable('best-scores-body');
    if (setupModalEl) {
      try { setupModalEl.showModal(); } catch(e){}
    }
  }

  function readSetupConfig() {
    if (!setupFormEl) return { mode: "cpu", level: "3", color: "black", hintInit: false, speechEnabled: true, passphrase: "" };
    const modeEl = setupFormEl.querySelector('input[name="mode"]:checked');
    const colorEl = setupFormEl.querySelector('input[name="color"]:checked');
    const levelEl = document.getElementById('setup-level');
    
    const modeVal = modeEl ? modeEl.value : "cpu";
    const colorVal = colorEl ? colorEl.value : "black";
    const levelVal = levelEl ? levelEl.value : "3";
    
    const hintCheckbox = document.getElementById("setup-hint");
    const hintVal = hintCheckbox ? hintCheckbox.checked : false;

    const speechCheckbox = document.getElementById("setup-speech");
    const speechVal = speechCheckbox ? speechCheckbox.checked : true;

    const pass = passphraseInput ? passphraseInput.value.trim() : "";

    return {
      mode: modeVal,
      level: levelVal,
      color: colorVal,
      hintInit: hintVal,
      speechEnabled: speechVal,
      passphrase: pass
    };
  }

  if (setupFormEl) {
    setupFormEl.addEventListener("submit", (e) => {
      e.preventDefault();
      const cfg = readSetupConfig();
      if (cfg.mode === "online") {
        startOnlineGame(cfg.passphrase, cfg.hintInit, cfg.speechEnabled);
      } else {
        startGame(cfg);
      }
    });
  }

  function setupSupabaseClient() {
    try {
      if (!supabaseClient) {
        if (typeof supabase === 'undefined') {
          console.warn('Supabase library blocked by client. Extension block active.');
          return false;
        }
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      }
      return !!supabaseClient;
    } catch (e) {
      console.warn('Supabase initialization blocked safely:', e);
      return false;
    }
  }

  function createClientId() {
    return `c_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
  }

  function resetOnlineSelection() {
    const btnBlack = document.getElementById('btn-online-black');
    const btnWhite = document.getElementById('btn-online-white');
    if (btnBlack) {
      btnBlack.classList.remove('btn-selected');
      btnBlack.style.removeProperty('background-color');
    }
    if (btnWhite) {
      btnWhite.classList.remove('btn-selected');
      btnWhite.style.removeProperty('background-color');
    }
  }

  function clearOnlineChoiceState(statusEl) {
    colorChoices = {};
    resetOnlineSelection();
    const btnStart = document.getElementById('btn-online-game-start');
    if (btnStart) {
      btnStart.style.display = 'none';
      btnStart.disabled = true;
      btnStart.onclick = null;
    }
    const instructionEl = document.getElementById('online-instruction');
    if (instructionEl) {
      instructionEl.style.display = 'block';
    }
    if (statusEl) {
      statusEl.textContent = '同じ色が選ばれました。もう一度選んでください。';
    }
  }

  function broadcastResetSelection() {
    if (onlineChannel) {
      try {
        onlineChannel.send({
          type: 'broadcast',
          event: 'reset',
          payload: { clientId }
        });
      } catch (e) {
        console.error('Broadcast reset failed:', e);
      }
    }
  }

  function startOnlineGame(passphrase, hintInit, speechEnabledParam) {
    if (!passphrase) {
      alert('合言葉を入力してください');
      return;
    }

    if (!setupSupabaseClient()) {
      alert('通信エラー: 広告ブロック等の拡張機能やプライバシー保護機能によりオンライン対戦への接続が遮断されました。拡張機能をオフにするか、CPU対戦をお楽しみください。');
      showSetup();
      return;
    }
    
    room = passphrase;
    clientId = createClientId();
    colorChoices = {};
    networked = true;
    myColor = null;
    opponentColor = null;

    // 追加: チャンネル名用に文字列を正規化し、URLエンコードして安全な半角英数字にする
    const safeChannelId = encodeURIComponent(passphrase.normalize('NFKC'));

    if (messageEl) messageEl.textContent = '合言葉待機中… ' + room;

    const modal = document.getElementById('modal-online-color');
    const statusEl = document.getElementById('online-status');
    if (statusEl) {
      statusEl.textContent = 'Supabase に接続中…';
    }
    if (modal) {
      try { modal.showModal(); } catch(e){}
    }
    const btnStart = document.getElementById('btn-online-game-start');
    if (btnStart) {
      btnStart.style.display = 'none';
      btnStart.disabled = true;
      btnStart.onclick = null;
    }
    const instructionEl = document.getElementById('online-instruction');
    if (instructionEl) {
      instructionEl.style.display = 'block';
    }
    if (setupModalEl) {
      try { setupModalEl.close(); } catch(e){}
    }

    if (onlineChannel) {
      try { onlineChannel.unsubscribe(); } catch(e){}
      onlineChannel = null;
    }

    try {
      // 修正: room ではなく safeChannelId を指定する
      onlineChannel = supabaseClient.channel(`room-${safeChannelId}`)
        .on('broadcast', { event: 'color' }, ({ payload }) => {
          if (payload.clientId === clientId) return;
          colorChoices[payload.clientId] = payload.color;
          const instructionEl = document.getElementById('online-instruction');
          if (instructionEl) {
            instructionEl.style.display = 'block';
          }
          resolveOnlineColors(hintInit, speechEnabledParam, statusEl, modal);
        })
        .on('broadcast', { event: 'reset' }, ({ payload }) => {
          if (payload.clientId === clientId) return;
          clearOnlineChoiceState(statusEl);
        })
        .on('broadcast', { event: 'move' }, ({ payload }) => {
          if (payload.clientId === clientId) return;
          handleRemoteMove(payload);
        });

      onlineChannel.subscribe();
      if (statusEl) {
        statusEl.textContent = '合言葉待機中… 相手の参加を待っています。';
      }
    } catch (error) {
      console.error('オンライン接続エラー', error);
      if (statusEl) {
        statusEl.textContent = 'オンライン接続に失敗しました。接続がブロックされている可能性があります。';
      }
    }

    const btnBlack = document.getElementById('btn-online-black');
    const btnWhite = document.getElementById('btn-online-white');
    if (btnBlack) btnBlack.onclick = () => {
      sendOnlineColorChoice('black', hintInit, speechEnabledParam, statusEl, modal);
    };
    if (btnWhite) btnWhite.onclick = () => {
      sendOnlineColorChoice('white', hintInit, speechEnabledParam, statusEl, modal);
    };
  }

  function sendOnlineColorChoice(color, hintInit, speechEnabledParam, statusEl, modal) {
    if (!onlineChannel) return;
    const btnGameStart = document.getElementById('btn-online-game-start');
    if (btnGameStart) {
      btnGameStart.style.display = 'none';
      btnGameStart.disabled = true;
      btnGameStart.onclick = null;
    }
    const instructionEl = document.getElementById('online-instruction');
    if (instructionEl) instructionEl.style.display = 'block';
    colorChoices[clientId] = color;
    if (statusEl) statusEl.textContent = `あなたは${color === 'black' ? '黒' : '白'}を選択しました。相手の選択を待っています。`;

    try {
      onlineChannel.send({
        type: 'broadcast',
        event: 'color',
        payload: { clientId, color }
      });
    } catch (e) {
      console.error('Failed to send color choice:', e);
    }

    resolveOnlineColors(hintInit, speechEnabledParam, statusEl, modal);
  }

  function resolveOnlineColors(hintInit, speechEnabledParam, statusEl, modal) {
    const ids = Object.keys(colorChoices);
    if (ids.length < 2) return;

    const colors = ids.map((id) => colorChoices[id]);
    const uniqueColors = [...new Set(colors)];
    if (uniqueColors.length === 1) {
      clearOnlineChoiceState(statusEl);
      broadcastResetSelection();
      return;
    }

    const assigned = colorChoices[clientId];
    if (statusEl) statusEl.textContent = 'ゲーム開始ボタンを押してゲームを始めてください。';
    
    const instructionEl = document.getElementById('online-instruction');
    if (instructionEl) {
      instructionEl.style.display = 'none';
    }
    
    const btnGameStart = document.getElementById('btn-online-game-start');
    if (btnGameStart) {
      btnGameStart.style.display = 'block';
      btnGameStart.disabled = false;
      btnGameStart.onclick = () => {
        if (modal) {
          try { modal.close(); } catch(e){}
        }
        startGame({ mode: 'pvp', level: '2', color: assigned, hintInit, speechEnabled: speechEnabledParam });
        if (messageEl) messageEl.textContent = '対局開始 — あなたは ' + (assigned === 'black' ? '黒（先手）' : '白（後手）');
      };
    }
  }

  function handleRemoteMove(payload) {
    const row = payload.row;
    const col = payload.col;
    const playerColor = payload.color === 'black' ? BLACK : WHITE;

    currentPlayer = playerColor;
    const flips = getFlipsOn(board, row, col, playerColor);
    board[row][col] = playerColor;
    const flippedKeys = new Set();
    if (flips) {
      for (const [fr, fc] of flips) {
        board[fr][fc] = playerColor;
        flippedKeys.add(`${fr},${fc}`);
      }
    }
    endTurn(flippedKeys);
  }

  function updateSetupLabels() {
    if (!setupFormEl) return;
    const checkedMode = setupFormEl.querySelector('input[name="mode"]:checked');
    const modeVal = checkedMode ? checkedMode.value : "cpu";
    const isCpu = modeVal === "cpu";
    const isOnline = modeVal === "online";
    
    const levelControl = document.getElementById("cpu-level-control");
    if (levelControl) {
      levelControl.style.display = isCpu ? "block" : "none";
    }
    const levelSlider = document.getElementById("setup-level");
    if (levelSlider) {
      updateCpuLevelLabel(levelSlider.value);
    }

    const colorSection = colorLegendEl ? colorLegendEl.closest('div') : null;

    if (isCpu) {
      if (colorSection) colorSection.style.display = "block"; 

      const colorInputs = setupFormEl.querySelectorAll('input[name="color"]');
      colorInputs.forEach(input => input.disabled = false);

      if (colorLegendEl) colorLegendEl.textContent = "あなたの色";
      if (colorHintEl) colorHintEl.textContent = "もう一方の色はCPUが操作します。黒が先手です。";
    } else {
      if (colorSection) colorSection.style.display = "none"; 

      const colorInputs = setupFormEl.querySelectorAll('input[name="color"]');
      colorInputs.forEach(input => {
        if (input.value === "black") {
          input.checked = true;
        }
      });
    }

    if (onlinePassphraseEl) {
      onlinePassphraseEl.style.display = isOnline ? "block" : "none";
    }

    handleModeSelection();
  }

  function handleModeSelection() {
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const charZone = document.getElementById("char-zone");

    if (mode === "online") {
      if (charZone) {
        charZone.classList.add("char-zone--hidden");
      }
    } else {
      if (charZone) {
        charZone.classList.remove("char-zone--hidden");
      }
    }
  }

  async function initializeApp() {
    try {
      await loadCharacters();

      if (setupFormEl) {
        setupFormEl.querySelectorAll('input[name="mode"]').forEach((input) => {
          input.addEventListener("change", updateSetupLabels);
        });
      }
      
      const setupLevelInput = document.getElementById('setup-level');
      if (setupLevelInput) {
        setupLevelInput.addEventListener('input', () => updateCpuLevelLabel(setupLevelInput.value));
      }

      const bestScoresBtn = document.getElementById('btn-best-scores');
      if (bestScoresBtn) {
        bestScoresBtn.addEventListener('click', (e) => { e.preventDefault(); openBestScoresWindow(); });
      }

      const btnOnlineCancel = document.getElementById('btn-online-cancel');
      if (btnOnlineCancel) {
        btnOnlineCancel.addEventListener('click', (e) => { e.preventDefault(); showSetup(); });
      }

      const btnRestart = document.getElementById("btn-restart");
      if (btnRestart) { btnRestart.addEventListener("click", showSetup); }

      const btnModalRestart = document.getElementById("btn-modal-restart");
      if (btnModalRestart) { btnModalRestart.addEventListener("click", showSetup); }

      const btnHint = document.getElementById("btn-hint");
      if (btnHint) { btnHint.addEventListener("click", toggleHint); }
      
      if (gameoverBannerEl) {
        const handleGameoverBannerClick = () => {
          if (gameOver && gameoverModalEl && !gameoverModalEl.open) {
            try { gameoverModalEl.showModal(); } catch(e){}
          }
        };
        gameoverBannerEl.addEventListener("click", handleGameoverBannerClick);
      }
      if (boardWrapEl) {
        const handleBoardClick = () => {
          if (gameOver && gameoverModalEl && !gameoverModalEl.open) {
            try { gameoverModalEl.showModal(); } catch(e){}
          }
        };
        boardWrapEl.addEventListener("click", handleBoardClick);
      }

      if (gameAreaEl) {
        gameAreaEl.classList.remove("game-area--hidden"); 
        gameAreaEl.style.display = "block";
      }
      
      loadBestScores();
      updateBestScoresTable('best-scores-body');
      createBoard(); 
      renderBoard();
      
      updateSetupLabels();
      showSetup(); 

    } catch (initError) {
      console.warn("Recovered from internal init block error:", initError);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initializeApp());
  } else {
    initializeApp();
  }

})();