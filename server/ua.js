'use strict';
// Clasifica el User-Agent: navegador o bot, sistema operativo y si es movil. Reglas simples y rapidas.

const BOTS = [
  [/Googlebot|Google-InspectionTool|GoogleOther|AdsBot-Google|Mediapartners-Google/i, 'Google', 'search'],
  [/bingbot|BingPreview|msnbot/i, 'Bing', 'search'],
  [/YandexBot|YandexImages/i, 'Yandex', 'search'],
  [/Baiduspider/i, 'Baidu', 'search'],
  [/DuckDuckBot|DuckAssistBot/i, 'DuckDuckGo', 'search'],
  [/Applebot/i, 'Apple', 'search'],
  [/GPTBot|OAI-SearchBot|ChatGPT-User/i, 'OpenAI', 'ai'],
  [/ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai/i, 'Claude', 'ai'],
  [/PerplexityBot|Perplexity-User/i, 'Perplexity', 'ai'],
  [/Bytespider/i, 'ByteDance', 'ai'],
  [/meta-externalagent|FacebookBot|facebookexternalhit|meta-externalfetcher/i, 'Meta', 'social'],
  [/Twitterbot/i, 'X / Twitter', 'social'],
  [/WhatsApp/i, 'WhatsApp', 'social'],
  [/TelegramBot/i, 'Telegram', 'social'],
  [/LinkedInBot/i, 'LinkedIn', 'social'],
  [/AhrefsBot|SemrushBot|MJ12bot|DotBot|DataForSeoBot|BLEXBot|serpstatbot|SeznamBot|PetalBot/i, 'SEO', 'seo'],
  [/UptimeRobot|Pingdom|StatusCake|BetterUptime|Site24x7|monitoring/i, 'Monitor', 'monitor'],
  [/Let's Encrypt|cPanel|WordPress\//i, 'Sistema', 'system'],
  [/curl|Wget|python-requests|python-urllib|aiohttp|Go-http-client|okhttp|Java\/|libwww|axios|node-fetch|undici|Scrapy|HeadlessChrome|PhantomJS/i, 'Script', 'script'],
  [/bot|crawl|spider|slurp|scan|fetch|preview/i, 'Bot', 'other'],
];
const BROWSERS = [
  [/SamsungBrowser/i, 'Samsung Internet'], [/OPR\/|Opera/i, 'Opera'], [/Edg\//i, 'Edge'], [/Firefox\//i, 'Firefox'],
  [/CriOS|Chrome\//i, 'Chrome'], [/FxiOS/i, 'Firefox'], [/Version\/.*Safari/i, 'Safari'],
];
const OSES = [
  [/Android/i, 'Android'], [/iPhone|iPad|iPod/i, 'iOS'], [/Windows/i, 'Windows'], [/Mac OS X|Macintosh/i, 'macOS'],
  [/CrOS/i, 'ChromeOS'], [/Linux/i, 'Linux'],
];

const cache = new Map();
function parseUA(ua) {
  ua = String(ua || '');
  if (cache.has(ua)) return cache.get(ua);
  let out;
  if (!ua || ua === '-') out = { bot: true, name: 'Sin agente', kind: 'script', os: '', mobile: false };
  else {
    const b = BOTS.find(([re]) => re.test(ua));
    if (b) out = { bot: true, name: b[1], kind: b[2], os: '', mobile: false };
    else {
      const br = BROWSERS.find(([re]) => re.test(ua));
      const os = OSES.find(([re]) => re.test(ua));
      out = { bot: false, name: br ? br[1] : 'Otro navegador', kind: 'browser', os: os ? os[1] : '', mobile: /Mobile|Android|iPhone|iPad/i.test(ua) };
    }
  }
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  cache.set(ua, out);
  return out;
}

module.exports = { parseUA };
