import { createHash } from "node:crypto";

const gmailPattern = /^[^\s@]+@gmail\.com$/i;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

export default async (request) => {
  if (request.method !== "POST") {
    return json({ message: "Method not allowed." }, 405);
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !fromEmail) {
    console.error("Missing RESEND_API_KEY or RESEND_FROM_EMAIL.");
    return json({ message: "Email service is not configured yet." }, 503);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ message: "Invalid request body." }, 400);
  }

  const email = String(payload.email || "").trim().toLowerCase();
  if (!gmailPattern.test(email) || email.length > 254) {
    return json({ message: "Please enter a valid Gmail address." }, 400);
  }

  const idempotencyKey = createHash("sha256")
    .update(`boom-birds:${email}:${new Date().toISOString().slice(0, 10)}`)
    .digest("hex");

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [email],
      subject: "Your Boom Birds egg is reserved!",
      html: `
        <div style="background:#050a1d;padding:40px 20px;font-family:Arial,sans-serif;color:#d4d7e3">
          <div style="max-width:560px;margin:auto;border:1px solid #f97316;border-radius:16px;padding:32px;background:#091027;text-align:center">
            <div style="font-size:38px">🔥</div>
            <h1 style="margin:10px 0;color:#ffe099;font-size:30px">Your Egg Is Reserved!</h1>
            <p style="font-size:16px;line-height:1.6">Welcome to the Boom Birds OG Waitlist.</p>
            <p style="font-size:16px;line-height:1.6">We received your reservation successfully. Keep an eye on this inbox for the next announcement.</p>
            <p style="margin-top:28px;color:#f59e0b;font-weight:bold">Boom Birds · OG Waitlist</p>
          </div>
        </div>
      `,
      text: "Your Boom Birds egg is reserved! Welcome to the OG Waitlist. Keep an eye on this inbox for the next announcement.",
    }),
  });

  if (!resendResponse.ok) {
    const details = await resendResponse.text();
    console.error("Resend API error:", resendResponse.status, details);
    return json({ message: "The confirmation email could not be sent." }, 502);
  }

  return json({ message: "Confirmation email sent." });
};
