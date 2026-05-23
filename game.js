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

  const SUPABASE_URL = "https://iclfzueezuwsfoxibmww.supabase.co/rest/v1/";
  const SUPABASE_ANON_KEY = "sb_publishable_SThaSyCH5PIWMr-X5SkeCA_kiYBMz_3";

  let board;
  let currentPlayer;
  let validMoves;
  let gameOver;
  let hintVisible;
  let vsCpu;
  let cpuLevel; 
  let humanColor;
  let cpuColor;
  let cpuThinking;
  let isTransitioning = false; // ✨ ターン移行中の連打を禁止する絶対ロックフラグ
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

    const levelsRow = document.createElement("tr");
    levelsRow.className = "levels-row";
    const valuesRow = document.createElement("tr");
    valuesRow.className = "values-row";

    for (let level = 1; level <= 5; level++) {
      const levelCell = document.createElement("td");
      levelCell.textContent = `${level}`;
      levelsRow.appendChild(levelCell);

      const valueCell = document.createElement("td");
      valueCell.textContent = formatBestScore(bestScores[level]);
      if (vsCpu && cpuLevel === level && gameOver) {
        valueCell.classList.add("updated");
      }
      valuesRow.appendChild(valueCell);
    }

    container.appendChild(levelsRow);
    container.appendChild(valuesRow);
  }

  function clearBestScores() {
    for (let i = 1; i <= 5; i++) bestScores[i] = 0;
    saveBestScores();
    updateBestScoresTable();
    // update popup/modal table if present
    updateBestScoresTable('best-scores-body-popup');
  }

  function openBestScoresWindow() {
    const modal = document.getElementById('modal-best-scores');
    if (!modal) {
      alert('ベストスコア表示用モーダルが見つかりません。');
      return;
    }
    loadBestScores();
    updateBestScoresTable('best-scores-body-popup');
    try { modal.showModal(); } catch(e) { modal.setAttribute('open',''); }

    const btnClear = document.getElementById('btn-clear-best-scores');
    const btnBack = document.getElementById('btn-back-best-scores');
    if (btnClear) {
      const handleClearClick = () => {
        const yes = confirm('ベストスコアを全てクリアしますか？');
        if (!yes) return;
        clearBestScores();
      };
      btnClear.addEventListener('click', handleClearClick);
      btnClear.addEventListener('touchend', handleClearClick);
    }
    if (btnBack) {
      const handleBackClick = () => {
        try { modal.close(); } catch(e) { modal.removeAttribute('open'); }
      };
      btnBack.addEventListener('click', handleBackClick);
      btnBack.addEventListener('touchend', handleBackClick);
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
    if (level === 1) return "（とても弱いCPU）";
    if (level === 2) return "（弱いCPU）";
    if (level === 3) return "（普通CPU）";
    if (level === 4) return "（強いCPU）";
    return "（とても強いCPU）";
  }

  function levelDescription(level) {
    if (level === 1) return "とても弱い";
    if (level === 2) return "弱い";
    if (level === 3) return "普通";
    if (level === 4) return "強い";
    return "とても強い";
  }

  function updateCpuLevelLabel(level) {
    const labelEl = document.getElementById('setup-level-label');
    if (labelEl) {
      labelEl.textContent = levelDescription(parseInt(level, 10));
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
    labelBlackEl.textContent = `黒${roleFor(BLACK)}`;
    labelWhiteEl.textContent = `白${roleFor(WHITE)}`;
    
    let modeText = "2人対戦";
    if (vsCpu) {
      modeText = `CPU対戦 (${levelDescription(cpuLevel)})`;
    } else if (networked) {
      modeText = "オンライン対戦";
    }
    subtitleEl.textContent = `${modeText} — 黒が先手`;

    cardBlackEl.classList.toggle("is-you", (vsCpu && humanColor === BLACK) || (networked && myColor === BLACK));
    cardWhiteEl.classList.toggle("is-you", (vsCpu && humanColor === WHITE) || (networked && myColor === WHITE));
  }

  function turnLabel() {
    if (gameOver) return "終了";
    if (vsCpu) {
      if (currentPlayer === humanColor) return "あなたの番";
      return "CPUの手番…";
    }
    if (networked) {
      return currentPlayer === myColor ? "あなたの番" : "相手の番";
    }
    return `${colorName(currentPlayer)}の番`;
  }

  function isCpuTurn() {
    return vsCpu && currentPlayer === cpuColor;
  }

  function updateScoreboard() {
    const { black, white } = countPieces();
    countBlackEl.textContent = black;
    countWhiteEl.textContent = white;

    cardBlackEl.classList.toggle("active", !gameOver && currentPlayer === BLACK);
    cardWhiteEl.classList.toggle("active", !gameOver && currentPlayer === WHITE);

    turnTextEl.textContent = turnLabel();
    turnDiscEl.className = `turn-disc disc--${currentPlayer === BLACK ? "black" : "white"}`;
  }

  function renderBoard(animateFlips) {
    boardEl.innerHTML = "";
    
    const isHumanTurn = !gameOver && ((vsCpu && currentPlayer === humanColor) || (networked && currentPlayer === myColor) || (!vsCpu && !networked));

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "cell";
        cell.setAttribute("role", "gridcell");
        cell.setAttribute("aria-label", `マス ${r + 1}行 ${c + 1}列`);

        const key = `${r},${c}`;
        const isValid = validMoves.has(key);

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
    const flips = validMoves.get(key);
    
    // ⚡ 絶対ロック：ゲーム終了、CPU番、またはターン切り替えアニメーション中なら即拒否
    if (!flips || gameOver || isCpuTurn() || isTransitioning) return;

    // クリックされた瞬間にロックを有効化
    isTransitioning = true;
    validMoves = new Map();

    board[row][col] = currentPlayer;
    const flippedKeys = new Set();
    for (const [fr, fc] of flips) {
      board[fr][fc] = currentPlayer;
      flippedKeys.add(`${fr},${fc}`);
    }

    messageEl.textContent = "";

    if (networked && currentPlayer !== myColor) {
      isTransitioning = false;
      return;
    }

    if (networked && onlineChannel) {
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
    }

    endTurn(flippedKeys);
  }

  function passMessage(passedPlayer) {
    if (!vsCpu) {
      return `${colorName(passedPlayer)}は置けないためパス。${colorName(currentPlayer)}の番です`;
    }
    if (passedPlayer === cpuColor) {
      return "CPUは置けないためパス。あなたの番です";
    }
    return "あなたは置けないためパス。CPUの番です";
  }

  function updateHintButtonText() {
    document.getElementById("btn-hint").textContent = hintVisible
      ? "ヒントを隠す"
      : "置ける場所を表示";
  }

  function endTurn(animateFlips) {
    renderBoard(animateFlips);
    updateScoreboard();

    window.setTimeout(() => {
      const next = opponent(currentPlayer);
      const nextMoves = computeValidMovesOn(board, next);

      if (nextMoves.size > 0) {
        currentPlayer = next;
        validMoves = nextMoves;
        gameOver = false;
        renderBoard(); 
        updateScoreboard();
        
        // 次の手番の準備が完了したのでロック解除
        isTransitioning = false; 
        
        scheduleCpuTurn();
        return;
      }

      const passMoves = computeValidMovesOn(board, currentPlayer);
      if (passMoves.size > 0) {
        currentPlayer = next; 
        validMoves = new Map(); 
        messageEl.textContent = passMessage(next);
        
        renderBoard();
        updateScoreboard();

        window.setTimeout(() => {
          if (gameOver) {
            isTransitioning = false;
            return;
          }
          currentPlayer = opponent(next); 
          validMoves = passMoves;          
          messageEl.textContent = "";     
          renderBoard();
          updateScoreboard();
          
          // パスを挟んだ後の手番の準備が完了したのでロック解除
          isTransitioning = false; 
          
          scheduleCpuTurn(); 
        }, 1500);
        
        return;
      }

      // ゲーム終了時もロック解除
      isTransitioning = false; 
      finishGame();
    }, 400); 
  }

  function resultMessage(black, white) {
    if (!vsCpu) {
      if (black > white) return `黒の勝ち！（${black} 対 ${white}）`;
      if (white > black) return `白の勝ち！（${black} 対 ${white}）`;
      return `引き分け！（${black} 対 ${white}）`;
    }

    const humanCount = humanColor === BLACK ? black : white;
    const cpuCount = humanColor === BLACK ? white : black;
    if (humanCount > cpuCount) {
      return `あなたの勝ち！（${humanCount} 対 ${cpuCount}）`;
    }
    if (humanCount < cpuCount) {
      return `CPUの勝ち！（${humanCount} 対 ${cpuCount}）`;
    }
    return `引き分け！（${humanCount} 対 ${cpuCount}）`;
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
    const recordUpdated = vsCpu && humanCount !== null && updateBestScoreIfNeeded(humanCount);

    turnTextEl.textContent = "終了";
    messageEl.textContent = result;
    const scoreText = `${black} 対 ${white}`;
    modalBodyEl.innerHTML = `
      <div class="modal-score">${scoreText}</div>
      ${recordUpdated ? '<div class="best-score-badge">New Record!</div>' : ''}
    `;
    // 更新されたベストスコアを読み込み、モーダル内の表を更新
    loadBestScores();
    updateBestScoresTable();

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
    cpuThinking = false;
    isTransitioning = false; // ✨ ゲーム開始時にフラグをリセット
    messageEl.textContent = "";

    hideGameoverBanner();
    updatePlayerLabels();
    updateHintButtonText(); 
    gameAreaEl.classList.remove("game-area--hidden");
    setupModalEl.close(); 
    renderBoard();
    updateScoreboard();
    scheduleCpuTurn();
  }

  function showSetup() {
    gameOver = true;
    cpuThinking = false;
    if (onlineChannel) {
      onlineChannel.unsubscribe();
      onlineChannel = null;
    }
    networked = false;
    myColor = null;
    opponentColor = null;
    room = null;

    const onlineModalEl = document.getElementById('modal-online-color');
    if (onlineModalEl && onlineModalEl.open) {
      onlineModalEl.close();
    }

    gameAreaEl.classList.add("game-area--hidden");
    if (gameoverModalEl && gameoverModalEl.open) {
      gameoverModalEl.close();
    }
    hideGameoverBanner();
    loadBestScores();
    updateBestScoresTable();
    setupModalEl.showModal();
  }

  function readSetupConfig() {
    const modeEl = setupFormEl.querySelector('input[name="mode"]:checked');
    const colorEl = setupFormEl.querySelector('input[name="color"]:checked');
    const levelEl = document.getElementById('setup-level');
    
    const modeVal = modeEl ? modeEl.value : "cpu";
    const colorVal = colorEl ? colorEl.value : "black";
    const levelVal = levelEl ? levelEl.value : "3";
    
    const hintCheckbox = document.getElementById("setup-hint");
    const hintVal = hintCheckbox ? hintCheckbox.checked : false;

    const pass = passphraseInput ? passphraseInput.value.trim() : "";

    return {
      mode: modeVal,
      level: levelVal,
      color: colorVal,
      hintInit: hintVal,
      passphrase: pass
    };
  }

  setupFormEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const cfg = readSetupConfig();
    if (cfg.mode === "online") {
      startOnlineGame(cfg.passphrase, cfg.hintInit);
    } else {
      startGame(cfg);
    }
  });

  setupFormEl.querySelectorAll('input[name="mode"]').forEach((input) => {
    input.addEventListener("change", updateSetupLabels);
  });
  const setupLevelInput = document.getElementById('setup-level');
  if (setupLevelInput) {
    setupLevelInput.addEventListener('input', () => updateCpuLevelLabel(setupLevelInput.value));
  }

  // ボタンイベント: ベストスコア別窓を開く
  const bestScoresBtn = document.getElementById('btn-best-scores');
  if (bestScoresBtn) {
    const handleBestScoresClick = (e) => {
      e.preventDefault();
      openBestScoresWindow();
    };
    bestScoresBtn.addEventListener('click', handleBestScoresClick);
    bestScoresBtn.addEventListener('touchend', handleBestScoresClick);
  }

  loadBestScores();
  updateBestScoresTable();

  const btnOnlineCancel = document.getElementById('btn-online-cancel');
  if (btnOnlineCancel) {
    const handleOnlineCancel = (e) => {
      e.preventDefault();
      showSetup();
    };
    btnOnlineCancel.addEventListener('click', handleOnlineCancel);
    btnOnlineCancel.addEventListener('touchend', handleOnlineCancel);
    btnOnlineCancel.disabled = false;
  }

  const btnRestart = document.getElementById("btn-restart");
  btnRestart.addEventListener("click", showSetup);
  btnRestart.addEventListener("touchend", showSetup);

  const btnModalRestart = document.getElementById("btn-modal-restart");
  btnModalRestart.addEventListener("click", showSetup);
  btnModalRestart.addEventListener("touchend", showSetup);

  const btnHint = document.getElementById("btn-hint");
  btnHint.addEventListener("click", toggleHint);
  btnHint.addEventListener("touchend", toggleHint);
  if (gameoverBannerEl) {
    const handleGameoverBannerClick = () => {
      if (gameOver && !gameoverModalEl.open) {
        gameoverModalEl.showModal();
      }
    };
    gameoverBannerEl.addEventListener("click", handleGameoverBannerClick);
    gameoverBannerEl.addEventListener("touchend", handleGameoverBannerClick);
  }
  if (boardWrapEl) {
    const handleBoardClick = () => {
      if (gameOver && !gameoverModalEl.open) {
        gameoverModalEl.showModal();
      }
    };
    boardWrapEl.addEventListener("click", handleBoardClick);
    boardWrapEl.addEventListener("touchend", handleBoardClick);
  }

  function toggleHint() {
    if (gameOver || (vsCpu && currentPlayer === cpuColor)) return;
    hintVisible = !hintVisible;
    renderBoard();
    updateHintButtonText();
  }

  // --- ネット対戦関連 ---
  function setupSupabaseClient() {
    if (!supabaseClient) {
      supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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
    enableColorButtons(true);
    if (statusEl) {
      statusEl.textContent = '同じ色が選ばれました。もう一度選んでください。';
    }
  }

  function broadcastResetSelection() {
    if (onlineChannel) {
      onlineChannel.send({
        type: 'broadcast',
        event: 'reset',
        payload: { clientId }
      });
    }
  }

  function startOnlineGame(passphrase, hintInit) {
    if (!passphrase) {
      alert('合言葉を入力してください');
      return;
    }

    setupSupabaseClient();
    room = passphrase;
    clientId = createClientId();
    colorChoices = {};
    networked = true;
    myColor = null;
    opponentColor = null;

    messageEl.textContent = '合言葉待機中… ' + room;

    const modal = document.getElementById('modal-online-color');
    const statusEl = document.getElementById('online-status');
    if (statusEl) statusEl.textContent = '色を選択してください';
    if (modal) modal.showModal();
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
    setupModalEl.close();

    if (onlineChannel) {
      onlineChannel.unsubscribe();
      onlineChannel = null;
    }

    onlineChannel = supabaseClient.channel(`room-${room}`)
      .on('broadcast', { event: 'color' }, ({ payload }) => {
        if (payload.clientId === clientId) return;
        colorChoices[payload.clientId] = payload.color;
        const instructionEl = document.getElementById('online-instruction');
        if (instructionEl) {
          instructionEl.style.display = 'block';
        }
        resolveOnlineColors(hintInit, statusEl, modal);
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

    const btnBlack = document.getElementById('btn-online-black');
    const btnWhite = document.getElementById('btn-online-white');
    if (btnBlack) btnBlack.onclick = () => {
      sendOnlineColorChoice('black', hintInit, statusEl, modal);
    };
    if (btnWhite) btnWhite.onclick = () => {
      sendOnlineColorChoice('white', hintInit, statusEl, modal);
    };
  }

  function sendOnlineColorChoice(color, hintInit, statusEl, modal) {
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

    onlineChannel.send({
      type: 'broadcast',
      event: 'color',
      payload: { clientId, color }
    });

    resolveOnlineColors(hintInit, statusEl, modal);
  }

  function resolveOnlineColors(hintInit, statusEl, modal) {
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
    
    // 下部の説明テキストを非表示にする
    const instructionEl = document.getElementById('online-instruction');
    if (instructionEl) {
      instructionEl.style.display = 'none';
    }
    
    const btnGameStart = document.getElementById('btn-online-game-start');
    if (btnGameStart) {
      btnGameStart.style.display = 'block';
      btnGameStart.disabled = false;
      btnGameStart.onclick = () => {
        if (modal) modal.close();
        startGame({ mode: 'pvp', level: '2', color: assigned, hintInit });
        messageEl.textContent = '対局開始 — あなたは ' + (assigned === 'black' ? '黒（先手）' : '白（後手）');
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

    const colorSection = colorLegendEl.closest('div');

    if (isCpu) {
      if (colorSection) colorSection.style.display = "block"; 

      const colorInputs = setupFormEl.querySelectorAll('input[name="color"]');
      colorInputs.forEach(input => input.disabled = false);

      colorLegendEl.textContent = "あなたの色";
      colorHintEl.textContent = "もう一方の色はCPUが操作します。黒が先手です。";
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
  }
})();