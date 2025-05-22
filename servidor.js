const express         = require("express");
const session         = require("express-session");
const handlebars      = require("express-handlebars");
const { MongoClient } = require("mongodb");
const bcrypt          = require("bcryptjs");          // <-- hashing

const app     = express();
const segredo = "kjsjdr3kjdskjsfkjjkq4tfklf";        // chave da sessão
let users;                                           // coleção MongoDB

/* -------------------- Middlewares globais -------------------- */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: segredo,
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));
app.engine("handlebars", handlebars.engine());
app.set("view engine", "handlebars");
app.set("views", "./views");
app.use(express.static(__dirname + "/public"));

/* -------------------- Autenticação -------------------- */
const autenticacao = (req, res, next) =>
  req.session.sessionId ? next()
                        : res.render("login", { mensagem: "Faça login para continuar" });

/* -------------------- Rotas públicas -------------------- */
app.get("/", (req,res)=>res.render("login"));
app.get("/login",(req,res)=>res.render("login"));
app.get("/register",(req,res)=>res.render("register"));

/* ---- registro com hash bcrypt ---- */
app.post("/register", async (req,res)=>{
  const { id, pass } = req.body;
  if (!id || !pass)
    return res.render("register",{mensagem:"Preencha todos os campos"});

  if (await users.findOne({ id }))
    return res.render("register",{mensagem:"ID já cadastrado"});

  const hash = await bcrypt.hash(pass, 10);          // custo 10
  await users.insertOne({ id, pass: hash, wins: 0 });

  res.render("login",{mensagem:"Conta criada – faça login"});
});

/* ---- login com verificação segura ---- */
app.post("/login", async (req,res)=>{
  const { id, pass } = req.body;
  const doc = await users.findOne({ id });
  if (doc && await bcrypt.compare(pass, doc.pass)) { // compara hash
    req.session.sessionId = id;
    return res.render("dashboard",{layout:false,page:"dashboard",
            usuario:id,wins:doc.wins});
  }
  res.render("login",{mensagem:"Credenciais inválidas"});
});

/* -------------------- Rotas protegidas -------------------- */
app.get("/dashboard", autenticacao, async (req,res)=>{
  const doc = await users.findOne({ id: req.session.sessionId });
  res.render("dashboard",{layout:false,page:"dashboard",
          usuario:req.session.sessionId,wins:doc?.wins??0});
});
app.get("/jogo", autenticacao, (req,res)=>
  res.render("jogo",{layout:false,page:"jogo",usuario:req.session.sessionId}));
app.get("/sobre",   autenticacao, (req,res)=>res.render("sobre",
          {usuario:req.session.sessionId}));
app.get("/contato", autenticacao, (req,res)=>res.render("contato",
          {usuario:req.session.sessionId}));
app.get("/logoff",  autenticacao, (req,res)=>{
  req.session.destroy();
  res.render("login",{mensagem:"Usuário saiu do sistema"});
});
app.get(/^(.+)$/,(req,res)=>res.render("login"));

/* -------------------- MongoDB + start -------------------- */
(async ()=>{
  const client = new MongoClient("mongodb://127.0.0.1:27017");
  await client.connect();
  users = client.db("AULAS").collection("users");
  console.log("Conectado ao MongoDB");
  app.listen(4000,()=>console.log("HTTP na porta 4000"));
})();