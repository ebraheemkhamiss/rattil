// يشتغل كل ١٥ دقيقة من GitHub Actions: بيبعت "حان وقت الحفظ" لمين وصله ميعاد تذكيره ولسه ما ذاكرش النهارده
// تشغيل يدوي مع force=true: بيبعت فورًا لكل من فعّل التذكير (للتجربة) من غير ما يبص على الوقت أو المذاكرة
import admin from 'firebase-admin';

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.error('Missing FIREBASE_SERVICE_ACCOUNT secret'); process.exit(1); }
const FORCE = process.env.FORCE === 'true';
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
const db = admin.firestore(), fcm = admin.messaging();

const WINDOW = 120; // لو الميعاد عدّى بأقل من ساعتين وما اتبعتش، لسه نبعت
const MSGS = [
  ['حان وقت الحفظ 📖', 'وردك اليومي مستنيك. دقايق قليلة مع كتاب الله.'],
  ['رتّل 🌙', 'لسه ما ذاكرتش النهارده. ابدأ بمراجعة بسيطة.'],
  ['تذكير الحفظ', 'الاستمرار أهم من الكمية. افتح رتل وراجع آية.'],
  ['حان وقت الحفظ 📖', 'سلسلة أيامك مستنياك، ما تقطعهاش.']
];

function localNow(tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, mins: (+p.hour) * 60 + (+p.minute), txt: `${p.hour}:${p.minute}` };
}

// بيرجّع سبب عدم الإرسال، أو null لو لازم نبعت
function skipReason(r, now) {
  if (FORCE) return null;
  const [h, m] = String(r.time || '20:00').split(':').map(Number), target = h * 60 + m;
  if (!(now.mins >= target && now.mins < target + WINDOW)) return `not in window (user local time ${now.txt}, reminder ${r.time || '20:00'}, window ${WINDOW} min)`;
  if (r.sent === now.date) return 'already sent today';
  if (r.last === now.date) return 'studied today';
  if (!r.strict && r.seen === now.date) return 'opened the app today (strict is off)';
  return null;
}

const snap = await db.collection('users').where('rem.on', '==', true).get();
console.log(`mode=${FORCE ? 'FORCE' : 'normal'} users_with_reminder_on=${snap.size}`);
if (!snap.size) console.log('No users have rem.on=true. In the app: sign in, enable the reminder, then press the diagnostics button.');
let sent = 0, skipped = 0;
for (const doc of snap.docs) {
  const id = doc.id.slice(0, 6) + '…';
  const r = doc.get('rem') || {};
  let now; try { now = localNow(r.tz || 'Africa/Cairo'); } catch { now = localNow('Africa/Cairo'); }
  const why = skipReason(r, now);
  if (why) { console.log(`${id} skip: ${why}`); skipped++; continue; }
  const tokens = Array.isArray(r.tokens) ? r.tokens : [];
  if (!tokens.length) { console.log(`${id} skip: no device tokens saved`); skipped++; continue; }
  const [title, body] = MSGS[Number(now.date.replace(/-/g, '')) % MSGS.length];
  const dead = []; let ok = 0;
  for (const t of tokens) {
    try {
      await fcm.send({ token: t, data: { title, body, url: './' }, webpush: { headers: { TTL: '7200', Urgency: 'normal' } } });
      ok++;
    } catch (e) {
      const c = String(e.code || '');
      console.log(`${id} send error: ${c || e.message}`);
      if (c.includes('registration-token-not-registered') || c.includes('invalid-argument') || c.includes('invalid-registration-token')) dead.push(t);
    }
  }
  console.log(`${id} sent to ${ok}/${tokens.length} device(s)${dead.length ? `, removed ${dead.length} dead token(s)` : ''}`);
  await doc.ref.set({ rem: { ...(ok && !FORCE ? { sent: now.date } : {}), tokens: tokens.filter(t => !dead.includes(t)) } }, { merge: true });
  sent += ok;
}
console.log(`done: sent=${sent} skipped=${skipped} checked=${snap.size}`);
