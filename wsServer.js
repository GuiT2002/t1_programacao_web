const { WebSocketServer } = require("ws");
const { MongoClient }     = require("mongodb");
const crypto              = require("crypto");

const PORT = 8080, FACES = 24, GRACE = 5000;

/* MongoDB ---------------------------------------------------------------- */
const mongo = new MongoClient("mongodb://127.0.0.1:27017");
let users;
(async () => {
  await mongo.connect();
  users = mongo.db("AULAS").collection("users");
  console.log("[WS] Conectado ao MongoDB");
})();

/* Estruturas ------------------------------------------------------------- */
const wss     = new WebSocketServer({ port: PORT });
const sockets = new Map();   // id → ws
const timers  = new Map();   // id → timeoutId
const online  = new Set();   // ids on-line
const rooms   = new Map();   // roomId → { players, secrets }
const pending = new Map();   // id → [json strings]

/* Utilitárias ------------------------------------------------------------ */
const randFace = () => Math.floor(Math.random()*FACES)+1;
const other    = (r,me)=> r.players[0]===me? r.players[1]:r.players[0];
const roomBy   = id=>[...rooms].find(([_,r])=>r.players.includes(id))||null;

const queue = (to,obj)=>{
  if(!pending.has(to)) pending.set(to,[]);
  pending.get(to).push(JSON.stringify(obj));
};
const flush = to=>{
  const ws=sockets.get(to);
  if(!ws||ws.readyState!==ws.OPEN) return;
  (pending.get(to)||[]).forEach(m=>ws.send(m));
  pending.delete(to);
};

/* vitórias + lista on-line ---------------------------------------------- */
const addWin = async id=>{
  await users.updateOne({id},{$inc:{wins:1}});
  broadcastOnline();                    // refaz lista com placar atualizado
};

async function broadcastOnline(){
  const ids=[...online];
  if(ids.length===0) return;
  const docs = await users.find({id:{$in:ids}})
                          .project({ _id:0,id:1,wins:1}).toArray();
  const msg = JSON.stringify({type:"online", list:docs});
  sockets.forEach(ws=>ws.readyState===ws.OPEN && ws.send(msg));
}

/* Conexões --------------------------------------------------------------- */
wss.on("connection", ws=>{
  let myId=null;

  ws.on("message",async raw=>{
    let msg; try{msg=JSON.parse(raw);}catch{ return; }

    /* registro */
    if(msg.type==="register"){
      myId=msg.user;
      if(timers.has(myId)){ clearTimeout(timers.get(myId)); timers.delete(myId); }
      if(sockets.has(myId)&&sockets.get(myId)!==ws) sockets.get(myId).close();
      sockets.set(myId,ws); online.add(myId);
      flush(myId); await broadcastOnline(); return;
    }
    if(!myId) return;

    /* convite */
    if(msg.type==="invite"){
      const obj={type:"invite",from:myId};
      const dstWs=sockets.get(msg.to);
      dstWs&&dstWs.readyState===dstWs.OPEN ? dstWs.send(JSON.stringify(obj))
                                           : queue(msg.to,obj);
      return;
    }

    /* aceite */
    if(msg.type==="accept"){
      const foe=msg.from;
      if(!sockets.has(foe)) return;

      const roomId=crypto.randomUUID();
      let s1=randFace(),s2; do{s2=randFace();}while(s2===s1);
      rooms.set(roomId,{players:[myId,foe],secrets:{[myId]:s1,[foe]:s2}});

      const mk=p=>({type:"start",room:roomId,board:FACES,
                    yourSecret:rooms.get(roomId).secrets[p]});
      [myId,foe].forEach(p=>{
        const o=mk(p);
        const w=sockets.get(p);
        w&&w.readyState===w.OPEN ? w.send(JSON.stringify(o)) : queue(p,o);
      });
      return;
    }

    /* partida */
    const data=roomBy(myId); if(!data) return;
    const [rid,r]=data, foeId=other(r,myId);
    const deliver=o=>{
      const w=sockets.get(foeId);
      w&&w.readyState===w.OPEN ? w.send(JSON.stringify(o)) : queue(foeId,o);
    };

    switch(msg.type){
      case"question":case"answer":
        deliver({...msg,from:myId}); break;
      case"guess":
        const win=msg.face===r.secrets[foeId];
        deliver({type:"result",won:!win});
        sockets.get(myId)?.send(JSON.stringify({type:"result",won:win}));
        if(win) await addWin(myId);
        rooms.delete(rid); break;
    }
  });

  /* desconexão c/ GRACE -------------------------------------------------- */
  ws.on("close",()=>{
    if(!myId) return;
    const tid=setTimeout(()=>{
      sockets.delete(myId); timers.delete(myId); online.delete(myId);
      broadcastOnline();
      const rInfo=roomBy(myId);
      if(rInfo){
        const foeId=other(rInfo[1],myId);
        queue(foeId,{type:"abort"}); rooms.delete(rInfo[0]);
      }
    },GRACE);
    timers.set(myId,tid);
  });
});

console.log(`[WS] WebSocket na porta ${PORT}`);
