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
  const colorLegendEl = document.getElementById("color-legend");
  const colorHintEl = document.getElementById("color-hint");
  const gameoverModalEl = document.getElementById("modal-gameover");
  const modalBodyEl = document.getElementById("modal-body");

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

  function colorName(player) {
    return player === BLACK ? "黒" : "白";
  }

  function levelName(level) {
    if (level === 1) return "（弱いCPU）";
    if (level === 2) return "（普通CPU）";
    return "（強いCPU）";
  }

  function roleFor(player) {
    if (!vsCpu) return "";
    if (player === humanColor) return "（あなた）";
    return levelName(cpuLevel);
  }

  function updatePlayerLabels() {
    labelBlackEl.textContent = `黒${roleFor(BLACK)}`;
    labelWhiteEl.textContent = `白${roleFor(WHITE)}`;
    
    let modeText = "2人対戦";
    if (vsCpu) {
      if (cpuLevel === 1) modeText = "CPU対戦 (弱い)";
      else if (cpuLevel === 2) modeText = "CPU対戦 (普通)";
      else modeText = "CPU対戦 (強い)";
    }
    subtitleEl.textContent = `${modeText} — 黒が先手`;

    cardBlackEl.classList.toggle("is-you", vsCpu && humanColor === BLACK);
    cardWhiteEl.classList.toggle("is-you", vsCpu && humanColor === WHITE);
  }

  function turnLabel() {
    if (gameOver) return "終了";
    if (!vsCpu) return `${colorName(currentPlayer)}の番`;
    if (currentPlayer === humanColor) return "あなたの番";
    return "CPUの手番…";
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
    
    const isHumanTurn = !gameOver && (!vsCpu || currentPlayer === humanColor);

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
          cell.addEventListener("click", () => makeMove(r, c));
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
    else if (cpuLevel === 2) depth = 3;

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

    turnTextEl.textContent = "終了";
    messageEl.textContent = result;
    modalBodyEl.textContent = result;
    gameoverModalEl.showModal();
  }

  function startGame(config) {
    vsCpu = config.mode === "cpu";
    cpuLevel = parseInt(config.level, 10);
    humanColor = config.color === "black" ? BLACK : WHITE;
    cpuColor = vsCpu ? opponent(humanColor) : null;

    createBoard();
    currentPlayer = BLACK;
    validMoves = computeValidMovesOn(board, BLACK);
    gameOver = false;
    hintVisible = config.hintInit; 
    cpuThinking = false;
    isTransitioning = false; // ✨ ゲーム開始時にフラグをリセット
    messageEl.textContent = "";

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
    gameAreaEl.classList.add("game-area--hidden");
    gameoverModalEl.close();
    setupModalEl.showModal();
  }

  function readSetupConfig() {
    const modeEl = setupFormEl.querySelector('input[name="mode"]:checked');
    const colorEl = setupFormEl.querySelector('input[name="color"]:checked');
    const levelEl = setupFormEl.querySelector('input[name="level"]:checked');
    
    const modeVal = modeEl ? modeEl.value : "cpu";
    const colorVal = colorEl ? colorEl.value : "black";
    const levelVal = levelEl ? levelEl.value : "2";
    
    const hintCheckbox = document.getElementById("setup-hint");
    const hintVal = hintCheckbox ? hintCheckbox.checked : false;

    return {
      mode: modeVal,
      level: levelVal,
      color: colorVal,
      hintInit: hintVal
    };
  }

  setupFormEl.addEventListener("submit", (e) => {
    e.preventDefault();
    startGame(readSetupConfig());
  });

  setupFormEl.querySelectorAll('input[name="mode"]').forEach((input) => {
    input.addEventListener("change", updateSetupLabels);
  });

  document.getElementById("btn-restart").addEventListener("click", showSetup);
  document.getElementById("btn-modal-restart").addEventListener("click", showSetup);
  document.getElementById("btn-hint").addEventListener("click", toggleHint);

  function toggleHint() {
    if (gameOver || (vsCpu && currentPlayer === cpuColor)) return;
    hintVisible = !hintVisible;
    renderBoard();
    updateHintButtonText();
  }

  function updateSetupLabels() {
    const checkedMode = setupFormEl.querySelector('input[name="mode"]:checked');
    const isCpu = checkedMode ? (checkedMode.value === "cpu") : true;
    
    const levelControl = document.getElementById("cpu-level-control");
    if (levelControl) {
      levelControl.style.display = isCpu ? "block" : "none";
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
  }
})();