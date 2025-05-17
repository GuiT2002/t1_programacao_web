/*  public/app.js ------------------------------------------------------------
    Cliente WebSocket – Jogo Cara-a-Cara
    • Mostra nomes em vez de “rosto #n”
-----------------------------------------------------------------------------*/

/* ---------------------- Mapeamento índice → nome ------------------------- */
const NAMES = [
  "Susanna","alfredo","filippo","chirara","paolo","giuseppe",
  "samuele","giorgio","anita","manuele","marco","riccardo",
  "tommaso","alessandro","carlo","ernesto","guglielmo","maria",
  "roberto","pietro","davide","bernardo","anna","giacomo"
];
const nameOf = i => NAMES[i - 1];        // i de 1 a 24

/* ---------------------------- Variáveis globais -------------------------- */
let ws;
let currentUser = null;
let dash = null;     // elementos da página dashboard
let game = null;     // elementos da página jogo

document.addEventListener("DOMContentLoaded", () => {
    const body = document.body;
    currentUser = body.dataset.user;
    if (!currentUser) return;

    initWebSocket();

    if (body.dataset.page === "dashboard") initDashboard();
    if (body.dataset.page === "jogo")      initGame();
});

/* ------------------------------- WebSocket ------------------------------- */
function initWebSocket() {
    ws = new WebSocket(`ws://${location.hostname}:8080`);
    ws.addEventListener("open", () =>
        ws.send(JSON.stringify({ type:"register", user:currentUser })));
    ws.addEventListener("message", handleWS);
    ws.addEventListener("close", () => setTimeout(initWebSocket, 1000));
}

function handleWS(ev) {
    const msg = JSON.parse(ev.data);

    /* --- eventos comuns ao dashboard --- */
    if (dash) {
        if (msg.type === "online") updateOnline(msg.list);
        if (msg.type === "invite") inviteReceived(msg.from);
    }

    /* --- início de partida --- */
    if (msg.type === "start") {
        if (game) startGame(msg);
        else {
            sessionStorage.setItem("caraStart", ev.data);
            location.href = "/jogo";
        }
        return;
    }

    /* --- eventos da partida --- */
    if (!game) return;

    switch (msg.type) {
        case "question":
            log(`${msg.from} pergunta: ${msg.text}`);
            enableAnswer();
            break;
        case "answer":
            log(`${msg.from} respondeu: ${msg.text}`);
            unlockQuestion();
            break;
        case "result":
            finish(msg.won ? "Você venceu!" : "Você perdeu!");
            break;
        case "abort":
            finish("Conexão do adversário perdida");
            break;
    }
}

/* ------------------------------------------------------------------------- */
/*                                DASHBOARD                                  */
/* ------------------------------------------------------------------------- */
function initDashboard() {
    dash = { ul: document.getElementById("ulOnline") };
}

function updateOnline(list) {
    dash.ul.innerHTML = "";
    list.filter(id => id !== currentUser).forEach(id => {
        const li = document.createElement("li");
        li.className = "list-group-item list-group-item-action";
        li.textContent = id;
        li.style.cursor = "pointer";
        li.onclick = () => {
            ws.send(JSON.stringify({ type:"invite", to:id }));
            alert("Convite enviado a " + id);
        };
        dash.ul.appendChild(li);
    });
}

function inviteReceived(from) {
    if (confirm(`Jogador ${from} quer jogar com você. Aceitar?`)) {
        ws.send(JSON.stringify({ type:"accept", from }));
        alert("Aguardando o início da partida…");
    }
}

/* ------------------------------------------------------------------------- */
/*                                   JOGO                                    */
/* ------------------------------------------------------------------------- */
function initGame() {
    game = {
        board : document.getElementById("board"),
        log   : document.getElementById("log"),
        form  : document.getElementById("formPergunta"),
        input : document.getElementById("txtPergunta"),
        btnS  : document.getElementById("btnSIM"),
        btnN  : document.getElementById("btnNAO"),
        btnG  : document.getElementById("btnGuess"),
        sel   : document.getElementById("selFace")
    };

    /* pergunta */
    game.form.onsubmit = ev => {
        ev.preventDefault();
        const txt = game.input.value.trim();
        if (!txt) return;
        ws.send(JSON.stringify({ type:"question", text:txt }));
        log("Você perguntou: " + txt);
        game.input.value = "";
        game.input.disabled = true;
    };

    /* respostas SIM / NÃO */
    game.btnS.onclick = () => sendAnswer("SIM");
    game.btnN.onclick = () => sendAnswer("NÃO");

    /* palpite */
    game.btnG.onclick = () => {
        const face = parseInt(game.sel.value, 10);
        const nome = nameOf(face);
        if (confirm(`Seu palpite é ${nome}. Confirmar?`))
            ws.send(JSON.stringify({ type:"guess", face }));
    };

    /* mensagem start armazenada? */
    const cached = sessionStorage.getItem("caraStart");
    if (cached) {
        startGame(JSON.parse(cached));
        sessionStorage.removeItem("caraStart");
    }
}

function startGame(msg) {
    buildBoard(msg.board);
    log(`Partida iniciada! Seu personagem secreto é ${nameOf(msg.yourSecret)}`);
    game.sel.value = msg.yourSecret;
}

function buildBoard(total) {
    game.board.innerHTML = "";
    game.sel.innerHTML = "";
    for (let i = 1; i <= total; i++) {
        const img = document.createElement("img");
        img.src = `/f${i}.png`;
        img.alt = nameOf(i);
        img.title = nameOf(i);
        img.className = "face";
        img.onclick = () => img.classList.toggle("apagada");
        game.board.appendChild(img);

        const opt = document.createElement("option");
        opt.value = i;
        opt.textContent = nameOf(i);
        game.sel.appendChild(opt);
    }
}

function sendAnswer(text) {
    ws.send(JSON.stringify({ type:"answer", text }));
    log("Você respondeu: " + text);
    game.btnS.disabled = game.btnN.disabled = true;
}

function enableAnswer() {
    game.btnS.disabled = game.btnN.disabled = false;
}

function unlockQuestion() {
    game.input.disabled = false;
    game.input.focus();
}

function log(txt) {
    game.log.value += txt + "\n";
    game.log.scrollTop = game.log.scrollHeight;
}

function finish(msg) {
    alert(msg);
    location.href = "/dashboard";
}

/* -------------------- CSS inline -------------------- */
const style = document.createElement("style");
style.textContent = `
    .face{width:120px;height:120px;margin:4px;cursor:pointer;transition:.3s}
    .face.apagada{filter:opacity(.2)}
    #board{display:flex;flex-wrap:wrap;justify-content:center}
`;
document.head.appendChild(style);
