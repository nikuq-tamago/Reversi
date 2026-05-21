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
  const onlinePassphraseEl = document.getElementById("online-passphrase");
  const passphraseInput = document.getElementById("setup-passphrase");
  const colorLegendEl = document.getElementById("color-legend");
  const colorHintEl = document.getElementById("color-hint");
  const gameoverModalEl = document.getElementById("modal-gameover");
  const modalBodyEl = document.getElementById("modal-body");

  const SUPABASE_URL = "https://iclfzueezuwsfoxibmww.supabase.co";
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
  let roomMatched = false;

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
      if (cpuLevel === 1) modeText = "CPU対戦 (弱い)";
      else if (cpuLevel === 2) modeText = "CPU対戦 (普通)";
      else modeText = "CPU対戦 (強い)";
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

    turnTextEl.textContent = "終了";
    messageEl.textContent = result;
    modalBodyEl.textContent = result;
    gameoverModalEl.showModal();
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
    closeOnlineModal();
    resetOnlineSelection();
    if (onlineChannel) {
      onlineChannel.unsubscribe();
      onlineChannel = null;
    }
    networked = false;
    myColor = null;
    opponentColor = null;
    room = null;
    roomMatched = false;

    enableColorButtons(false);
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

  document.getElementById("btn-restart").addEventListener("click", showSetup);
  document.getElementById("btn-modal-restart").addEventListener("click", showSetup);
  document.getElementById("btn-hint").addEventListener("click", toggleHint);

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

  function enableColorButtons(enabled) {
    const btnBlack = document.getElementById('btn-online-black');
    const btnWhite = document.getElementById('btn-online-white');
    if (btnBlack) {
      btnBlack.disabled = !enabled;
      btnBlack.classList.toggle('btn-disabled', !enabled);
    }
    if (btnWhite) {
      btnWhite.disabled = !enabled;
      btnWhite.classList.toggle('btn-disabled', !enabled);
    }
  }

  function resetOnlineSelection() {
    const btnBlack = document.getElementById('btn-online-black');
    const btnWhite = document.getElementById('btn-online-white');
    if (btnBlack) {
      btnBlack.classList.remove('btn-selected');
    }
    if (btnWhite) {
      btnWhite.classList.remove('btn-selected');
    }
  }

  function clearOnlineChoiceState(statusEl) {
    colorChoices = {};
    resetOnlineSelection();
    const btnBlack = document.getElementById('btn-online-black');
    const btnWhite = document.getElementById('btn-online-white');
    if (btnBlack) {
      btnBlack.style.removeProperty('background-color');
    }
    if (btnWhite) {
      btnWhite.style.removeProperty('background-color');
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

  function updateColorButtonState(selectedColor) {
    const btnBlack = document.getElementById('btn-online-black');
    const btnWhite = document.getElementById('btn-online-white');
    
    // 両方のボタンから btn-selected を削除
    if (btnBlack) btnBlack.classList.remove('btn-selected');
    if (btnWhite) btnWhite.classList.remove('btn-selected');
    
    // 選択されたボタンに btn-selected を追加
    if (selectedColor === 'black' && btnBlack) {
      btnBlack.classList.add('btn-selected');
    } else if (selectedColor === 'white' && btnWhite) {
      btnWhite.classList.add('btn-selected');
    }
  }

  function closeOnlineModal() {
    const onlineModal = document.getElementById('modal-online-color');
    if (onlineModal && onlineModal.open) {
      onlineModal.close();
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
    roomMatched = false;
    networked = true;
    myColor = null;
    opponentColor = null;

    resetOnlineSelection();
    messageEl.textContent = '合言葉待機中… ' + room;

    const modal = document.getElementById('modal-online-color');
    const statusEl = document.getElementById('online-status');
    if (statusEl) statusEl.textContent = '合言葉待機中';
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
      .on('broadcast', { event: 'join' }, ({ payload }) => {
        if (payload.clientId === clientId) return;
        if (!roomMatched) {
          roomMatched = true;
          const instructionEl = document.getElementById('online-instruction');
          if (instructionEl) instructionEl.style.display = 'block';
          if (statusEl) statusEl.textContent = '色を選択してください。';
          if (modal) modal.showModal();
          enableColorButtons(true);
          onlineChannel.send({
            type: 'broadcast',
            event: 'confirm',
            payload: { clientId }
          });
        }
      })
      .on('broadcast', { event: 'confirm' }, ({ payload }) => {
        if (payload.clientId === clientId) return;
        if (!roomMatched) {
          roomMatched = true;
          const instructionEl = document.getElementById('online-instruction');
          if (instructionEl) instructionEl.style.display = 'block';
          if (statusEl) statusEl.textContent = '色を選択してください。';
          if (modal) modal.showModal();
          enableColorButtons(true);
        }
      })
      .on('broadcast', { event: 'color' }, ({ payload }) => {
        if (payload.clientId === clientId) return;
        colorChoices[payload.clientId] = payload.color;
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
    const broadcastJoin = () => {
      if (onlineChannel) {
        onlineChannel.send({
          type: 'broadcast',
          event: 'join',
          payload: { clientId }
        });
      }
    };
    setTimeout(broadcastJoin, 200);
    setTimeout(broadcastJoin, 1200);

    const btnBlack = document.getElementById('btn-online-black');
    const btnWhite = document.getElementById('btn-online-white');
    const btnCancel = document.getElementById('btn-online-cancel');
    
   // =========================================================================
    // 【修正後】オンライン色選択ボタンのイベント登録（ここを丸ごと上書きします）
    // =========================================================================
    if (btnBlack) {
      const newBtnBlack = btnBlack.cloneNode(true);
      btnBlack.parentNode.replaceChild(newBtnBlack, btnBlack);
      
      // 開いた瞬間は背景色を初期化（どちらも選ばれていない状態にする）
      newBtnBlack.style.removeProperty('background-color');

      newBtnBlack.addEventListener('click', () => {
        if (!roomMatched) return;
        
        // 1. 相手に黒を選択したことを送信
        sendOnlineColorChoice('black', hintInit, statusEl, modal);
        
        // 2. 黒ボタンを青く光らせて、白ボタンの光を消す（!importantを上書き）
        newBtnBlack.style.setProperty('background-color', '#2563eb', 'important');
        const wBtn = document.getElementById('btn-online-white');
        if (wBtn) wBtn.style.removeProperty('background-color');
      });
    }

    if (btnWhite) {
      const newBtnWhite = btnWhite.cloneNode(true);
      btnWhite.parentNode.replaceChild(newBtnWhite, btnWhite);
      
      // 開いた瞬間は背景色を初期化（どちらも選ばれていない状態にする）
      newBtnWhite.style.removeProperty('background-color');

      newBtnWhite.addEventListener('click', () => {
        if (!roomMatched) return;
        
        // 1. 相手に白を選択したことを送信
        sendOnlineColorChoice('white', hintInit, statusEl, modal);
        
        // 2. 白ボタンを青く光らせて、黒ボタンの光を消す（!importantを上書き）
        newBtnWhite.style.setProperty('background-color', '#2563eb', 'important');
        const bBtn = document.getElementById('btn-online-black');
        if (bBtn) bBtn.style.removeProperty('background-color');
      });
    }
    
    if (btnCancel) {
      const newBtnCancel = btnCancel.cloneNode(true);
      btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);
      newBtnCancel.addEventListener('click', () => {
        showSetup();
      });
    }

    enableColorButtons(false);
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
    const btnBlack = document.getElementById('btn-online-black');
    const btnWhite = document.getElementById('btn-online-white');
    if (btnBlack && btnWhite) {
      btnBlack.classList.remove('btn-selected');
      btnWhite.classList.remove('btn-selected');
      if (color === 'black') {
        btnBlack.classList.add('btn-selected');
      } else {
        btnWhite.classList.add('btn-selected');
      }
    }

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
    if (!roomMatched) return;
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