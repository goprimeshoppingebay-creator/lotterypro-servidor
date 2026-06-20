// ═══════════════════════════════════════════════════════════════
//  DESCOBRIR CONFIGURAÇÃO — corre uma vez para confirmar, a partir
//  do feed, as regras exatas de cada loteria (bolas, intervalos,
//  bónus, moeda). Depois colas o resultado ao Claude.
//
//  COMO CORRER (na mesma pasta do server.js, com o .env):
//     node descobrir-config.js
// ═══════════════════════════════════════════════════════════════

require("dotenv").config();
const API_KEY = process.env.LOTTERY_API_KEY;
const BASE = "https://www.lotteryresultsfeed.com/api";

// IDs já confirmados (Reino Unido, Irlanda, Alemanha, Itália).
// França e Espanha vamos descobrir automaticamente pela listagem.
const IDS_CONHECIDOS = [
  727, 728, 724, 725, 730,          // UK: Lotto, EuroMillions, Thunderball, Set for Life, Health Lottery
  717, 718, 719, 722, 721, 715, 716,// IE: Lotto, Lotto Plus 1/2, EuroMillions, EuroDreams, Daily Million (+Plus)
  700, 708,                          // DE: Lotto 6aus49, EuroJackpot
  712, 710, 709, 711, 714,          // IT: SuperEnalotto, MillionDay, VinciCasa, SiVinceTutto, Lotto
];

async function get(path) {
  const r = await fetch(BASE + path, {
    headers: { "Authorization": "Bearer " + API_KEY, "Accept": "application/json" },
  });
  if (!r.ok) throw new Error(r.status + " " + r.statusText);
  return r.json();
}

async function config(id) {
  const d = await get(`/lottery/lottery?id=${id}`);
  const l = d.lottery || {};
  const ci = l.country_info || {};
  return {
    id: l.id, nome: l.name, pais: l.country,
    escolhe: l.main_balls_to_pick, de: l.main_balls_count, comeca: l.main_ball_start_number,
    bonus_escolhe: l.bonus_balls_to_pick, bonus_de: l.bonus_balls_count,
    bonus_comeca: l.bonus_ball_start_number, bonus_nome: l.bonus_balls_name,
    moeda: ci.currency_symbol, odds: l.jackpot_odds,
  };
}

(async () => {
  if (!API_KEY) { console.log("⚠️ Falta a chave no .env"); return; }

  const ids = [...IDS_CONHECIDOS];

  // Descobrir IDs de França e Espanha pela listagem
  for (const pais of ["fr", "es"]) {
    try {
      const d = await get(`/lottery/lotteries?country=${pais}`);
      const lista = d.lotteries || d.data || (Array.isArray(d) ? d : []);
      console.log(`\n=== ${pais.toUpperCase()} encontradas ===`);
      lista.forEach(x => { console.log(`  id=${x.id}  ${x.name}`); ids.push(x.id); });
      if (!lista.length) console.log("  (nada — resposta crua:)", JSON.stringify(d).slice(0, 400));
    } catch (e) { console.log(`Falha a listar ${pais}: ${e.message}`); }
  }

  console.log("\n=== CONFIGURAÇÕES (cola isto tudo ao Claude) ===");
  for (const id of ids) {
    try { console.log(JSON.stringify(await config(id))); }
    catch (e) { console.log(`id=${id} falhou: ${e.message}`); }
  }
  console.log("\n✅ Pronto. Copia tudo acima e cola na conversa.");
})();
