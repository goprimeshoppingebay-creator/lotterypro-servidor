// ═══════════════════════════════════════════════════════════════
//  LotteryPro — Servidor de resultados reais  (v2 — já configurado)
//  Liga ao lotteryresultsfeed.com e serve os resultados ao site.
// ═══════════════════════════════════════════════════════════════
//
//  Já está configurado com os dados reais da API. Só precisas de:
//    1. npm install
//    2. ter o ficheiro .env com a tua chave (LOTTERY_API_KEY=...)
//    3. npm start
//    4. abrir  http://localhost:4000/api/resultados
//
// ═══════════════════════════════════════════════════════════════

const express = require("express");
const cron = require("node-cron");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 4000;

const API_KEY = process.env.LOTTERY_API_KEY;
const API_BASE = "https://www.lotteryresultsfeed.com/api"; // ← endereço REAL (com www e /api)

// ───────────────────────────────────────────────────────────────
//  As 4 loterias, com o ID REAL de cada uma na plataforma.
//  (UK Lotto 727 · EuroMillions 728 · EuroJackpot 708 · Thunderball 724)
// ───────────────────────────────────────────────────────────────
const LOTERIAS = [
  { id: "lotto",            feedId: 727 }, // UK Lotto
  { id: "euromillions",     feedId: 728 }, // EuroMillions (Reino Unido)
  { id: "eurojackpot",      feedId: 708 }, // EuroJackpot (sorteio europeu, listado na Alemanha)
  { id: "thunderball",      feedId: 724 }, // Thunderball
  { id: "setforlife",       feedId: 725 }, // Set for Life (UK)
  { id: "health",           feedId: 730 }, // Health Lottery (UK)
  { id: "ielotto",          feedId: 717 }, // Irish Lotto
  { id: "ielottoplus1",     feedId: 718 }, // Irish Lotto Plus 1
  { id: "ielottoplus2",     feedId: 719 }, // Irish Lotto Plus 2
  { id: "eurodreams",       feedId: 721 }, // EuroDreams (IE)
  { id: "dailymillion",     feedId: 715 }, // Daily Million (IE)
  { id: "dailymillionplus", feedId: 716 }, // Daily Million Plus (IE)
  { id: "lotto6aus49",      feedId: 700 }, // Lotto 6aus49 (Alemanha)
  { id: "superenalotto",    feedId: 712 }, // SuperEnalotto (Itália)
  { id: "millionday",       feedId: 710 }, // MillionDay (Itália)
  { id: "vincicasa",        feedId: 709 }, // VinciCasa (Itália)
  { id: "sivincetutto",     feedId: 711 }, // SiVinceTutto (Itália)
  { id: "frloto",           feedId: 734 }, // Loto (França)
  { id: "laprimitiva",      feedId: 805 }, // La Primitiva (Espanha)
  { id: "elgordo",          feedId: 806 }, // El Gordo (Espanha)
  { id: "bonoloto",         feedId: 807 }, // Bonoloto (Espanha)
];

let resultados = {};
let ultimaAtualizacao = null;

// Transforma o bónus (que pode ser 1 número, vários, ou nenhum) numa lista.
function normalizarBonus(b) {
  if (Array.isArray(b)) return b;
  if (b === null || b === undefined) return [];
  return [b];
}

// Formata o valor do prémio com o símbolo da moeda (ex: £8,400,000).
function formatarJackpot(valor, simbolo) {
  if (valor === null || valor === undefined || valor === "") return "";
  return (simbolo || "") + Number(valor).toLocaleString("en-GB");
}

// ───────────────────────────────────────────────────────────────
//  Vai buscar o ÚLTIMO resultado de UMA loteria.
// ───────────────────────────────────────────────────────────────
async function buscarLoteria(lot) {
  // Pedimos só o último sorteio (limit=1) usando o ID da loteria.
  const url = `${API_BASE}/lottery/results?id=${lot.feedId}&limit=1`;

  const resposta = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Accept": "application/json",
    },
  });

  if (!resposta.ok) {
    throw new Error(`Feed devolveu ${resposta.status} (${resposta.statusText})`);
  }

  const dados = await resposta.json();

  // O último sorteio vem em results[0] (ou em lottery.results_latest).
  const ultimo = (dados.results && dados.results[0]) || (dados.lottery && dados.lottery.results_latest);
  if (!ultimo) throw new Error("a resposta não trouxe sorteios");

  // Símbolo da moeda (£, €...) que vem dentro dos dados da loteria.
  const info = dados.lottery && dados.lottery.country_info ? dados.lottery.country_info : {};
  const simbolo = info.currency_symbol || "";

  // 🔎 Para EuroMillions e EuroJackpot (que têm 2 números extra), mostramos
  //    a resposta crua uma vez, para confirmarmos como vêm os 2 números.
  if (lot.id === "euromillions" || lot.id === "eurojackpot") {
    console.log(`   🔎 (${lot.id}) bónus recebido:`, JSON.stringify(ultimo.ball_bonus));
  }

  return {
    id: lot.id,
    nums: ultimo.balls || [],                 // números principais
    extra: normalizarBonus(ultimo.ball_bonus),// número(s) extra (bónus / estrelas)
    jack: formatarJackpot(ultimo.jackpot, simbolo),
    data: ultimo.draw_date || "",
  };
}

// ───────────────────────────────────────────────────────────────
//  Vai buscar TODAS as loterias e guarda os resultados.
// ───────────────────────────────────────────────────────────────
// Vai buscar a FREQUÊNCIA real (quentes/frios/atraso) de UMA loteria.
async function buscarFrequencia(lot) {
  const url = `${API_BASE}/lottery/frequency?id=${lot.feedId}`;
  const resposta = await fetch(url, {
    headers: { "Authorization": `Bearer ${API_KEY}`, "Accept": "application/json" },
  });
  if (!resposta.ok) throw new Error(`freq ${resposta.status}`);
  const dados = await resposta.json();
  const mb = (dados.frequency && dados.frequency.main_balls) || {};
  const freq = {}; const atraso = {};
  for (const n in mb) { freq[n] = mb[n].frequency; atraso[n] = mb[n].draws_since_last; }
  const janela = dados.frequency && dados.frequency.meta ? dados.frequency.meta.window_draws : null;
  return { freq, atraso, janela };
}

// Atualiza só os RESULTADOS (corre todos os dias). Mantém a frequência já guardada.
async function atualizarResultados() {
  console.log("⏳ A buscar RESULTADOS reais (diário)...");
  for (const lot of LOTERIAS) {
    try {
      const novo = await buscarLoteria(lot);
      const ant = resultados[lot.id] || {};
      // preserva a frequência/atraso vindos da atualização semanal
      novo.freq = ant.freq; novo.atraso = ant.atraso; novo.janela = ant.janela;
      resultados[lot.id] = novo;
      console.log(`   ✓ ${lot.id}: ${novo.nums.join(",")} + [${novo.extra.join(",")}]  ${novo.jack}  (${novo.data})`);
    } catch (e) {
      console.log(`   ✗ ${lot.id} falhou: ${e.message}`);
    }
  }
  ultimaAtualizacao = new Date().toISOString();
  console.log("✅ Resultados concluídos:", ultimaAtualizacao);
}

// Atualiza só as FREQUÊNCIAS (corre 1× por semana — muda pouco e poupa chamadas).
async function atualizarFrequencias() {
  console.log("📊 A buscar FREQUÊNCIAS reais (semanal)...");
  for (const lot of LOTERIAS) {
    try {
      const f = await buscarFrequencia(lot);
      if (!resultados[lot.id]) resultados[lot.id] = {};
      resultados[lot.id].freq = f.freq;
      resultados[lot.id].atraso = f.atraso;
      resultados[lot.id].janela = f.janela;
      console.log(`   ✓ ${lot.id}: frequência de ${Object.keys(f.freq).length} números (janela ${f.janela})`);
    } catch (e) {
      console.log(`   ✗ ${lot.id} frequência falhou: ${e.message}`);
    }
  }
  console.log("✅ Frequências concluídas");
}

// Faz os dois de uma vez (usado no arranque e na atualização manual).
async function atualizarTodos() {
  await atualizarResultados();
  await atualizarFrequencias();
}

// ───────────────────────────────────────────────────────────────
//  ROTAS
// ───────────────────────────────────────────────────────────────
// Endereços do teu site que podem pedir resultados (novo domínio + antigos).
const ORIGENS_PERMITIDAS = [
  "https://aimlottery.com",
  "https://www.aimlottery.com",
  "https://mylottolab.com",
  "https://www.mylottolab.com",
  "https://lotterypro-site.vercel.app",
];
app.use((req, res, next) => {
  const origem = req.headers.origin;
  if (origem && ORIGENS_PERMITIDAS.includes(origem)) {
    res.header("Access-Control-Allow-Origin", origem); // devolve o endereço que pediu, se for autorizado
  }
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.get("/api/resultados", (req, res) => {
  res.json({ ok: true, atualizado: ultimaAtualizacao, resultados: Object.values(resultados) });
});

app.get("/", (req, res) => {
  res.send("LotteryPro server a funcionar. Vai a /api/resultados");
});

app.get("/api/atualizar-agora", async (req, res) => {
  await atualizarTodos();
  res.json({ ok: true, atualizado: ultimaAtualizacao, resultados: Object.values(resultados) });
});

// ───────────────────────────────────────────────────────────────
//  AGENDAMENTO
//  • Resultados: todos os dias à meia-noite (hora de Londres)
//  • Frequências: 1× por semana, segunda-feira às 00:30 (poupa chamadas)
// ───────────────────────────────────────────────────────────────
cron.schedule("0 0 * * *", atualizarResultados, { timezone: "Europe/London" });
cron.schedule("30 0 * * 1", atualizarFrequencias, { timezone: "Europe/London" });

// ───────────────────────────────────────────────────────────────
//  ARRANQUE
// ───────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Servidor a correr em http://localhost:${PORT}`);
  if (!API_KEY) {
    console.log("⚠️  Falta a chave! Cria um ficheiro .env com LOTTERY_API_KEY=...");
  } else {
    atualizarTodos();
  }
});
