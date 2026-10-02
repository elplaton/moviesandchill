/**
 * Que aparato es cada user agent.
 *
 * Son cinco regex y una cadena mal puesta no da error: deja la app creyendo
 * que esta en una tele, sin cursor y sin los botones que en la consola son la
 * unica forma de manejarla. Los agentes de aqui son los de verdad.
 */
import { detectarPlataforma } from './platform.mjs';

let ok = 0, mal = 0;
function es(ua, esperado, nota, ventana) {
  const sale = detectarPlataforma(ua, ventana || {});
  if (sale === esperado) { ok++; console.log(`  ok   ${nota}`); }
  else { mal++; console.log(`  FALLA ${nota}: esperaba ${esperado}, salio ${sale}`); }
}

console.log('\nUser agents de cada aparato:');
es('Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1',
   'tizen', 'Samsung (Tizen 6.0)');
es('Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.41 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.41',
   'webos', 'LG (webOS 5)');
es('Mozilla/5.0 (Linux; Android 9; AFTKA Build/PS7285.3064N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.110',
   'firetv', 'Fire TV Stick (AFTKA)');
es('Mozilla/5.0 (PlayStation 4 11.00) AppleWebKit/605.1.15 (KHTML, like Gecko)',
   'playstation', 'PS4 (firmware 11)');
es('Mozilla/5.0 (PlayStation 4 5.55) AppleWebKit/601.2 (KHTML, like Gecko)',
   'playstation', 'PS4 (firmware viejo)');
es('Mozilla/5.0 (PlayStation; PlayStation 5/5.50) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0 Safari/605.1.15',
   'playstation', 'PS5 (navegador escondido)');
es('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
   'web', 'Chrome de escritorio');
es('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
   'web', 'iPhone (la app del movil es otra)');

console.log('\nPuentes nativos, aunque el agente no diga nada:');
es('cualquier cosa', 'tizen', 'window.tizen manda', { tizen: {} });
es('cualquier cosa', 'firetv', 'window.AndroidTV manda', { AndroidTV: { exit: () => {} } });

console.log(`\n${ok} correctas, ${mal} fallidas`);
process.exit(mal ? 1 : 0);
