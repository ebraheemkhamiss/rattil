// يشتغل كل ١٥ دقيقة من GitHub Actions: بيبعت "حان وقت الحفظ" لمين وصله ميعاد تذكيره ولسه ما ذاكرش النهارده
import admin from 'firebase-admin';

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.error('Missing FIREBASE_SERVICE_ACCOUNT secret'); process.exit(1); }
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
  return { date: `${p.year}-${p.month}-${p.day}`, mins: (+p.hour) * 60 + (+p.minute) };
}

const snap = await db.collection('users').where('rem.on', '==', true).get();
let sent = 0, skipped = 0;
for (const doc of snap.docs) {
  const r = doc.get('rem') || {};
  let now; try { now = localNow(r.tz || 'Africa/Cairo'); } catch { now = localNow('Africa/Cairo'); }
  const [h, m] = String(r.time || '20:00').split(':').map(Number), target = h * 60 + m;
  if (!(now.mins >= target && now.mins < target + WINDOW)) { skipped++; continue; }  // مش وقته
  if (r.sent === now.date) { skipped++; continue; }                                   // اتبعت النهارده
  if (r.last === now.date) { skipped++; continue; }                                   // ذاكر النهارده
  if (!r.strict && r.seen === now.date) { skipped++; continue; }                      // فتح التطبيق النهارده
  const tokens = Array.isArray(r.tokens) ? r.tokens : [];
  if (!tokens.length) { skipped++; continue; }
  const [title, body] = MSGS[Number(now.date.replace(/-/g, '')) % MSGS.length];
  const dead = []; let ok = 0;
  for (const t of tokens) {
    try {
      await fcm.send({ token: t, data: { title, body, url: './' }, webpush: { headers: { TTL: '7200', Urgency: 'normal' } } });
      ok++;
    } catch (e) {
      const c = String(e.code || '');
      if (c.includes('registration-token-not-registered') || c.includes('invalid-argument') || c.includes('invalid-registration-token')) dead.push(t);
      else console.error('send error', c);
    }
  }
  await doc.ref.set({ rem: { ...(ok ? { sent: now.date } : {}), tokens: tokens.filter(t => !dead.includes(t)) } }, { merge: true });
  sent += ok;
}
console.log(`done: sent=${sent} skipped=${skipped} checked=${snap.size}`);
