// Minimal transactional email sender. Uses Resend (RESEND_API_KEY) when
// configured; otherwise logs the email to the console instead of sending —
// same graceful-degradation pattern as content.js falling back to
// placeholder text when OPENAI_API_KEY is missing. Lets password reset (and
// any future transactional email) work in dev before a provider is wired up.
const FROM = process.env.EMAIL_FROM || 'LessonScope <onboarding@resend.dev>';

async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`\n[email:dev-fallback] No RESEND_API_KEY set — would have sent:\n  To: ${to}\n  Subject: ${subject}\n  ${html}\n`);
    return { dev: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Email send failed (${res.status}): ${body}`);
  }
  return res.json();
}

module.exports = { sendEmail };
