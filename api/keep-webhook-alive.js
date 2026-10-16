const ASANA_TOKEN = process.env.ASANA_TOKEN;
const ASANA_API = "https://app.asana.com/api/1.0";
const TICKETS_PROJECT_GID = process.env.ASANA_PROJECT_GID || "1219498756334922";

async function listWebhooks() {
  const r = await fetch(
    `${ASANA_API}/webhooks?workspace=&resource=${TICKETS_PROJECT_GID}`,
    { headers: { Authorization: `Bearer ${ASANA_TOKEN}` } }
  );
  const d = await r.json().catch(() => ({}));
  return d.data || [];
}

async function registerWebhook(baseUrl) {
  const r = await fetch(`${ASANA_API}/webhooks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ASANA_TOKEN}` },
    body: JSON.stringify({
      data: {
        resource: TICKETS_PROJECT_GID,
        target: `${baseUrl}/api/asana-ticket-closed`,
        filters: [{ resource_type: "task", action: "changed", fields: ["completed"] }],
      },
    }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${process.env.CRON_SECRET || ""}`) {
    return res.status(403).json({ error: "forbidden" });
  }

  const baseUrl = process.env.DIGEST_BASE_URL || "https://zoho-asana-webhook.vercel.app";
  const target = `${baseUrl}/api/asana-ticket-closed`;

  const webhooks = await listWebhooks();
  const existing = webhooks.find(w => w.target === target && w.active);

  if (existing) {
    console.log("Webhook active, gid:", existing.gid);
    return res.status(200).json({ status: "already_active", gid: existing.gid });
  }

  console.log("Webhook missing or inactive — re-registering");
  const result = await registerWebhook(baseUrl);
  console.log("Register result:", result.status, JSON.stringify(result.body));
  return res.status(200).json({ status: "re_registered", result });
}
