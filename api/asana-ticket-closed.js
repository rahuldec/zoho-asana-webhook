const ASANA_TOKEN = process.env.ASANA_TOKEN;
const ASANA_API   = "https://app.asana.com/api/1.0";
const TICKETS_PROJECT_GID = process.env.ASANA_PROJECT_GID || "1219498756334922";

const ACCENT   = "#B5501C";
const GREEN    = "#2E7D32";
const BLUE     = "#0066CC";
const LOGO_URL = "https://okiedokie-erp-images.s3.ap-south-1.amazonaws.com/Okie%20Dokie/2025/12/sourceURL/26aebcbe10f4ac5a3e8b-611ed1b9032568edd4f3-Okie_Dokie_App_icon__2___2_-removebg-preview.png";

const STYLE = `
  * { margin:0; padding:0; box-sizing:border-box;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; }
  body { background:#F5F4F1; padding:40px 16px; color:#1D1D1F; }
  .email-container { max-width:600px; width:100%; margin:0 auto; background:#FFFFFF;
    border:1px solid #E5E3DE; border-radius:12px; padding:36px 32px; }
  .masthead { text-align:center; margin-bottom:28px; }
  .masthead img { width:56px; height:56px; object-fit:contain; margin:0 auto 14px; display:block; }
  .masthead .eyebrow { font-size:11px; font-weight:600; letter-spacing:.12em; text-transform:uppercase;
    color:${GREEN}; margin:0 0 10px; }
  .masthead h1 { font-size:23px; font-weight:600; letter-spacing:-.01em; color:#1D1D1F; margin:0 0 6px; }
  .masthead .date { font-size:14px; color:#6E6E73; margin:0; }
  .divider { border:none; border-top:1px solid #E5E3DE; margin:28px 0; }
  .task-box { background:#F5F4F1; border-radius:8px; padding:16px 20px; }
  .task-box .label { font-size:10.5px; font-weight:600; letter-spacing:.06em; text-transform:uppercase;
    color:#8A8A8F; margin:0 0 6px; }
  .task-box .task-name { font-size:15px; font-weight:600; color:#1D1D1F; word-break:break-word; }
  .message { font-size:14px; color:#3A3A3C; line-height:1.6; margin:0; }
  .footer p { margin:0; font-size:12px; color:#8A8A8F; text-align:center; }
  .footer a { color:${ACCENT}; text-decoration:none; }
  @media (max-width:480px) {
    .email-container { padding:28px 20px; }
    .masthead h1 { font-size:20px; }
  }`;

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function buildHtml(instituteName, refNumber) {
  const dateStr = new Date().toLocaleDateString("en-GB",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return `<!doctype html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Ticket Resolved</title><style>${STYLE}</style></head>
<body><div class="email-container">
  <div class="masthead">
    <img src="${LOGO_URL}" alt="OkieDokie" width="56" height="56">
    <p class="eyebrow">Ticket Resolved</p>
    <h1>Your support ticket has been closed</h1>
    <p class="date">${dateStr}</p>
  </div>
  <hr class="divider">
  <p class="message">Dear ${esc(instituteName)},<br><br>
  We are happy to inform you that your support ticket has been reviewed and closed by our team.</p>
  <br>
  <div class="task-box">
    <p class="label">Ticket Reference</p>
    <p class="task-name">${esc(refNumber || instituteName)}</p>
  </div>
  <br>
  <p class="message">If your issue has not been fully resolved or you have further queries, please raise a new ticket and our team will get back to you promptly.</p>
  <br>
  <p style="text-align:center;">
    <a href="https://data.odpay.in/odforms1/form/BugTracker/entry/d440o1-7vgtXZx634O4D0odHiZZ6oz0ZP55zaxxWf8M"
       style="display:inline-block;background:${ACCENT};color:#ffffff;font-size:14px;font-weight:600;
              text-decoration:none;padding:12px 28px;border-radius:8px;letter-spacing:.01em;">
      Raise a New Ticket
    </a>
  </p>
  <hr class="divider">
  <div class="footer">
    <p>Automated Email Alert from <a href="https://okiedokiepay.com/" style="color:${ACCENT};text-decoration:none;">Okie Dokie</a></p>
  </div>
</div></body></html>`;
}

function parseClientEmail(notes) {
  if (!notes) return null;
  const m = notes.match(/^Email:\s*(.+@.+\..+)$/im);
  return m ? m[1].trim() : null;
}

function parseField(notes, field) {
  const m = notes.match(new RegExp(`^${field}:\\s*(.+)$`, "im"));
  return m ? m[1].trim() : null;
}

async function sendEmail(toAddress, instituteName, refNumber) {
  const r = await fetch("https://api.zeptomail.in/v1.1/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.ZEPTOMAIL_TOKEN || "",
    },
    body: JSON.stringify({
      from: { address: process.env.ZEPTOMAIL_SENDER || "alerts@okiedokie.app", name: "Okie Dokie Support" },
      to: [{ email_address: { address: toAddress } }],
      subject: "Your Support Ticket Has Been Resolved",
      htmlbody: buildHtml(instituteName, refNumber),
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`ZeptoMail ${r.status}: ${JSON.stringify(d)}`);
  return d;
}

export default async function handler(req, res) {
  // Self-registration: POST /api/asana-ticket-closed?register=1
  if (req.method === "POST" && req.query.register === "1") {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${process.env.CRON_SECRET || ""}`) {
      return res.status(403).json({ error: "forbidden" });
    }
    const baseUrl = process.env.DIGEST_BASE_URL || "https://zoho-asana-webhook.vercel.app";
    const r = await fetch(`${ASANA_API}/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ASANA_TOKEN}` },
      body: JSON.stringify({ data: {
        resource: TICKETS_PROJECT_GID,
        target: `${baseUrl}/api/asana-ticket-closed`,
        filters: [{ resource_type: "task", action: "changed", fields: ["completed"] }],
      }}),
    });
    return res.status(r.status).json(await r.json().catch(() => ({})));
  }

  // Asana handshake on first webhook registration
  const hookSecret = req.headers["x-hook-secret"];
  if (hookSecret) {
    res.setHeader("X-Hook-Secret", hookSecret);
    return res.status(200).end();
  }

  if (req.method !== "POST") return res.status(200).json({ status: "ok" });

  const events = (req.body && req.body.events) || [];

  const changedGids = [
    ...new Set(
      events
        .filter(ev => ev.resource?.resource_type === "task" && ev.resource?.gid)
        .map(ev => ev.resource.gid)
    ),
  ];

  if (!changedGids.length) return res.status(200).json({ skipped: true });

  const sent = [];

  for (const gid of changedGids) {
    try {
      const r = await fetch(`${ASANA_API}/tasks/${gid}?opt_fields=name,notes,completed`, {
        headers: { Authorization: `Bearer ${ASANA_TOKEN}` },
      });
      const task = (await r.json().catch(() => ({}))).data || {};

      if (!task.completed) continue;

      const notes = task.notes || "";
      const clientEmail = parseClientEmail(notes);
      if (!clientEmail) {
        console.log("No client email found in task", gid);
        continue;
      }

      const instituteName = task.name || parseField(notes, "Institute Name") || "there";
      const refNumber = parseField(notes, "Ticket ID") || parseField(notes, "Reference");

      await sendEmail(clientEmail, instituteName, refNumber);
      sent.push({ gid, email: clientEmail });
      console.log("Sent closure email for task", gid, "to", clientEmail);
    } catch (err) {
      console.error("Error processing task", gid, err.message);
    }
  }

  return res.status(200).json({ ok: true, sent });
}
