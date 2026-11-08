// Напоминания в Telegram. Запускается GitHub Actions по расписанию.
// Нужны секреты репозитория: BOT_TOKEN, CHAT_ID и переменная APP_URL (ссылка на GitHub Pages).
// Без BOT_TOKEN скрипт просто печатает сообщение (удобно для проверки).
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(dir, 'menu.js'), 'utf8');
const D = vm.runInNewContext(code + '\n;({ING, MEALS, SLOTS, PLANS, PLAN_BY_DOW, WORKOUT_BY_DOW, WORKOUTS})');

const { BOT_TOKEN, CHAT_ID, APP_URL } = process.env;
const DOW = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];

// Время по Москве (UTC+3) — можно подменить для проверки: NOW="2026-11-09T13:05"
const nowMsk = process.env.NOW
  ? new Date(process.env.NOW + 'Z')
  : new Date(Date.now() + 3 * 3600e3);
// «Логический» день начинается в 4 утра, как в приложении
const logical = new Date(nowMsk.getTime() - 4 * 3600e3);
const dow = logical.getUTCDay();
const tomorrowDow = (dow + 1) % 7;
let minutes = nowMsk.getUTCHours() * 60 + nowMsk.getUTCMinutes();
if (minutes < 240) minutes += 1440;

// Список событий за день (минуты от полуночи; 00:00 = 1440)
const events = D.SLOTS.map((s, i) => {
  const [h, m] = s.t.split(':').map(Number);
  return { type: 'meal', i, at: (h === 0 ? 24 : h) * 60 + m };
});
if (D.WORKOUT_BY_DOW[dow]) events.push({ type: 'workout', at: 17 * 60 + 30 });

// GitHub запускает задачи с задержкой, поэтому берём ближайшее событие в пределах часа
const ev = events
  .map(e => ({ ...e, diff: Math.abs(e.at - minutes) }))
  .filter(e => e.diff <= 60)
  .sort((a, b) => a.diff - b.diff)[0];

if (!ev) { console.log('Сейчас нет напоминаний'); process.exit(0); }

let text;
if (ev.type === 'meal') {
  const plan = D.PLANS[D.PLAN_BY_DOW[dow]];
  const slot = D.SLOTS[ev.i];
  const meal = D.MEALS[plan.meals[ev.i]];
  text = `🍽 <b>${slot.t} · ${slot.l}</b>\n${meal.name} (${meal.min} мин)`;
  if (ev.i === 0) {
    text = `Доброе утро! Сегодня ${DOW[dow]}, ${plan.title}.\n\n` + text;
    if (dow === 0) text += `\n\n⚖️ Сегодня воскресенье: взвесься натощак и запиши вес в приложении.`;
  }
  if (ev.i === D.SLOTS.length - 1) {
    const tomorrow = D.PLANS[D.PLAN_BY_DOW[tomorrowDow]];
    const preps = tomorrow.meals.map(id => D.MEALS[id].prep).filter(Boolean);
    if (preps.length) text += `\n\n📝 Перед сном ${preps.join('; ')}.`;
    text += `\n\nОтметь в приложении, что съел за день 👇`;
  }
} else {
  const w = D.WORKOUTS[D.WORKOUT_BY_DOW[dow]];
  text = `💪 <b>Тренировка: ${w.title}</b>\n~30 минут, турник и свой вес. Таймер отдыха в приложении.`;
}

console.log(text);
if (!BOT_TOKEN || !CHAT_ID) { console.log('\n(BOT_TOKEN/CHAT_ID не заданы — сообщение не отправлено)'); process.exit(0); }

const body = { chat_id: CHAT_ID, text, parse_mode: 'HTML' };
if (APP_URL) body.reply_markup = { inline_keyboard: [[{ text: 'Открыть приложение', web_app: { url: APP_URL } }]] };

const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const out = await res.json();
if (!out.ok) { console.error('Ошибка Telegram:', out.description); process.exit(1); }
console.log('Отправлено ✓');
