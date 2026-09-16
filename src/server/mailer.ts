/**
 * Outbound email.
 *
 * Squared sends exactly one transactional message — a password reset link —
 * so this is a single function over Resend's REST API rather than an SDK, a
 * template engine, and a queue. There is no new dependency: it is one fetch.
 *
 * When RESEND_API_KEY or EMAIL_FROM is unset the link is written to the
 * server log instead. That is what keeps the flow usable in local
 * development and on preview deployments, where no sending domain is
 * verified and a hard failure would make the feature untestable. It is a
 * visible degradation, logged as a warning, not a silent one.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resetEmailBody(name: string, link: string) {
  const safeName = escapeHtml(name);
  const safeLink = escapeHtml(link);

  const text = [
    `Hi ${name},`,
    "",
    "Someone asked to reset the password on your Squared account. Open this link to choose a new one:",
    "",
    link,
    "",
    "The link works once and expires in an hour. If this wasn't you, ignore this email — your password stays as it is.",
  ].join("\n");

  // Deliberately plain: inline styles only, a real <a> rather than a styled
  // button, and no images. Mail clients strip stylesheets, and a reset link
  // that renders as an unstyled paragraph still works.
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#1c1a17">
  <p>Hi ${safeName},</p>
  <p>Someone asked to reset the password on your Squared account. Choose a new one here:</p>
  <p><a href="${safeLink}" style="color:#1b4d3e;font-weight:600">Reset your password</a></p>
  <p style="color:#6e6862;font-size:13px">The link works once and expires in an hour. If this wasn't you, ignore this email — your password stays as it is.</p>
</div>`;

  return { text, html };
}

export async function sendPasswordResetEmail(params: {
  to: string;
  name: string;
  link: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.warn(
      `[mailer] RESEND_API_KEY/EMAIL_FROM not set — not sending mail. ` +
        `Password reset link for ${params.to}: ${params.link}`
    );
    return;
  }

  const { text, html } = resetEmailBody(params.name, params.link);
  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: params.to,
      subject: "Reset your Squared password",
      text,
      html,
    }),
  });

  if (!response.ok) {
    // The body carries Resend's reason (unverified domain, bad key). It is
    // logged by the caller and never returned to the browser.
    throw new Error(
      `Resend rejected the message (${response.status}): ${await response.text()}`
    );
  }
}
