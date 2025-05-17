/*  wsServer.js --------------------------------------------------------------
    Servidor WebSocket do jogo Cara-a-Cara
    — Corrige perda de conexão durante o redirecionamento de página:
        • “modo reconexão”: se o socket fecha, o servidor aguarda 5 s.
          Se o mesmo usuário voltar a registrar-se dentro desse prazo, a
          partida continua normalmente; caso contrário o adversário recebe
          “abort”.
        • Fila de mensagens pendentes (strings JSON) para eventos durante o
          intervalo de reconexão.
    — Entrega on-line, convite, partida, placar.
-----------------------------------------------------------------------------*/

const { WebSocketServer } = require("ws");
const { MongoClient }     = require("mongodb");
const crypto              = require("crypto");

const PORT   = 8080;
const FACES  = 24;
const GRACE  = 5000;              // ms de tolerância p/ reconexão

/* ------------------------------- MongoDB --------------------------------- */
const mongo = new MongoClient("mongodb://127.0.0.1:27017");
let users;
(async () => {
  await mongo.connect();
  users = mongo.db("AULAS").collection("users");
  console.log("[WS] Conectado ao MongoDB");
})();

/* ----------------------- Estruturas de memória --------------------------- */
const wss      = new WebSocketServer({ port: PORT });
const sockets  = new Map();     // id → ws
const timers   = new Map();     // id → timeoutId (grace)
const online   = new Set();     // ids on-line (já considerados ativos)
const rooms    = new Map();     // roomId → { players, secrets }
const pending  = new Map();     // id → array<string> mensagens JSON

/* --------------------------- Utilitárias --------------------------------- */
const randFace = () => Math.floor(Math.random() * FACES) + 1;
const other    = (r, me) => (r.players[0] === me ? r.players[1] : r.players[0]);
const roomBy   = id => [...rooms].find(([_,r]) => r.players.includes(id)) || null;

function queue(to, obj) {
  if (!pending.has(to)) pending.set(to, []);
  pending.get(to).push(JSON.stringify(obj));
}
function flush(to) {
  const ws = sockets.get(to);
  if (!ws || ws.readyState !== ws.OPEN) return;
  (pending.get(to) || []).forEach(m => ws.send(m));
  pending.delete(to);
}
function addWin(id) { users.updateOne({ id }, { $inc:{ wins:1 } }); }

function broadcastOnline() {
  const msg = JSON.stringify({ type:"online", list:[...online] });
  sockets.forEach(ws => ws.readyState === ws.OPEN && ws.send(msg));
}

/* ------------------------------ Conexões ---------------------------------- */
wss.on("connection", ws => {
  let myId = null;

  ws.on("message", async raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    /* ---------- registro ---------- */
    if (msg.type === "register") {
      myId = msg.user;

      /* cancela contagem de desconexão, se existir */
      if (timers.has(myId)) { clearTimeout(timers.get(myId)); timers.delete(myId); }

      /* fecha socket antigo se ainda existir */
      if (sockets.has(myId) && sockets.get(myId) !== ws)
        sockets.get(myId).close();

      sockets.set(myId, ws);
      online.add(myId);
      flush(myId);                 // envia o que estava pendente
      broadcastOnline();
      return;
    }
    if (!myId) return;             // ignora tudo antes de registrar

    /* ---------- convite ---------- */
    if (msg.type === "invite") {
      const dst = msg.to;
      const obj = { type:"invite", from:myId };
      const dstWs = sockets.get(dst);
      dstWs && dstWs.readyState === dstWs.OPEN ? dstWs.send(JSON.stringify(obj))
                                               : queue(dst,obj);
      return;
    }

    /* ---------- aceite ---------- */
    if (msg.type === "accept") {
      const foe = msg.from;
      if (!sockets.has(foe)) return;

      const idRoom = crypto.randomUUID();
      let s1 = randFace(), s2; do { s2 = randFace(); } while (s2 === s1);

      rooms.set(idRoom, { players:[myId, foe],
                          secrets:{ [myId]:s1, [foe]:s2 } });

      const mkStart = pid => ({ type:"start", room:idRoom,
                                board:FACES, yourSecret: rooms.get(idRoom).secrets[pid] });

      [myId, foe].forEach(pid => {
        const obj = mkStart(pid);
        const wsDst = sockets.get(pid);
        wsDst && wsDst.readyState === wsDst.OPEN ? wsDst.send(JSON.stringify(obj))
                                                 : queue(pid,obj);
      });
      return;
    }

    /* ---------- partida ---------- */
    const rData = roomBy(myId);
    if (!rData) return;
    const [rid, r] = rData;
    const foeId = other(r,myId);

    const deliver = o => {
      const dstWs = sockets.get(foeId);
      dstWs && dstWs.readyState === dstWs.OPEN ? dstWs.send(JSON.stringify(o))
                                               : queue(foeId,o);
    };

    switch (msg.type) {
      case "question":
      case "answer":
        deliver({ ...msg, from:myId });
        break;

      case "guess":
        const won = msg.face === r.secrets[foeId];
        deliver({ type:"result", won:!won });
        sockets.get(myId)?.send(JSON.stringify({ type:"result", won }));
        if (won) addWin(myId);
        rooms.delete(rid);
        break;
    }
  });

  /* ---------- desconexão (grace) ---------- */
  ws.on("close", () => {
    if (!myId) return;

    /* inicia contagem – se não reconectar em GRACE ms, aborta partida */
    const to = setTimeout(() => {
      sockets.delete(myId);
      timers.delete(myId);
      online.delete(myId);
      broadcastOnline();

      const rInfo = roomBy(myId);
      if (rInfo) {
        const foeId = other(rInfo[1], myId);
        queue(foeId,{ type:"abort" });
        rooms.delete(rInfo[0]);
      }
    }, GRACE);
    timers.set(myId, to);
  });
});

console.log(`[WS] WebSocket na porta ${PORT}`);
