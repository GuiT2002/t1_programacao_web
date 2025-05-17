/*  servidor.js --------------------------------------------------------------
    Servidor HTTP/Express + sessões para o jogo Cara-a-Cara.
-----------------------------------------------------------------------------*/

const express       = require("express");
const session       = require("express-session");
const handlebars    = require("express-handlebars");
const { MongoClient } = require("mongodb");

const segredo = "kjsjdr3kjdskjsfkjjkq4tfklf";
const app = express();

let disciplinas, users;

/* -------------------- Middlewares globais -------------------- */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: segredo,
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }      // 24 h
}));

app.engine("handlebars", handlebars.engine());
app.set("view engine", "handlebars");
app.set("views", "./views");

app.use(express.static(__dirname + "/public"));

/* -------------------- Autenticação -------------------- */
function autenticacao(req, res, next) {
  if (req.session.sessionId) return next();
  return res.render("login", { mensagem: "Faça login para continuar" });
}

/* -------------------- Rotas públicas -------------------- */
app.get("/",          (req, res) => res.render("login"));
app.get("/login",     (req, res) => res.render("login"));
app.get("/register",  (req, res) => res.render("register"));

app.post("/register", async (req, res) => {
  const { id, pass } = req.body;
  if (!id || !pass) return res.render("register", { mensagem: "Preencha todos os campos" });

  if (await users.findOne({ id }))
    return res.render("register", { mensagem: "ID já cadastrado" });

  await users.insertOne({ id, pass, wins: 0 });
  return res.render("login", { mensagem: "Conta criada – faça login" });
});

app.post("/login", async (req, res) => {
  const { id, pass } = req.body;
  const doc = await users.findOne({ id });
  if (doc && doc.pass === pass) {
    req.session.sessionId = id;
    return res.render("dashboard",
      { layout: false, page: "dashboard", usuario: id, cores: ["azul","amarelo","verde"] });
  }
  return res.render("login", { mensagem: "Credenciais inválidas" });
});

/* -------------------- Rotas protegidas -------------------- */
app.get("/dashboard", autenticacao, (req, res) =>
  res.render("dashboard",
    { layout: false, page: "dashboard", usuario: req.session.sessionId }));

app.get("/jogo", autenticacao, (req, res) =>
  res.render("jogo",
    { layout: false, page: "jogo", usuario: req.session.sessionId }));

app.get("/sobre",   autenticacao, (req, res) =>
  res.render("sobre", { usuario: req.session.sessionId }));

app.get("/contato", autenticacao, (req, res) =>
  res.render("contato", { usuario: req.session.sessionId }));

app.get("/logoff",  autenticacao, (req, res) => {
  req.session.destroy();
  res.render("login", { mensagem: "Usuário saiu do sistema" });
});

/* rota coringa */
app.get(/^(.+)$/, (req,res) => res.render("login"));

/* -------------------- MongoDB + start -------------------- */
async function conecta() {
  const client = new MongoClient("mongodb://127.0.0.1:27017");
  await client.connect();
  const db = client.db("AULAS");
  disciplinas = db.collection("disciplinas");
  users       = db.collection("users");
  console.log("Conectado ao MongoDB");

  app.listen(4000, () => console.log("HTTP na porta 4000"));
}
conecta();
