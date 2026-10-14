const ASANA_TOKEN = process.env.ASANA_TOKEN;
const ASANA_PROJECT_GID = process.env.ASANA_PROJECT_GID || "1219498756334922";
const TICKET_SENDER = "wecare@okiedokiepay.com";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { fromAddress, subject, content, summary } = req.body || {};

  if ((fromAddress || "").toLowerCase().trim() !== TICKET_SENDER) {
    return res.status(200).json({ status: "ignored", reason: "sender not whitelisted" });
  }

  const taskName = subject || "(No Subject)";
  const notes = `From: ${fromAddress}\n\n${content || summary || ""}`.trim();

  const resp = await fetch("https://app.asana.com/api/1.0/tasks", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ASANA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data: {
        name: taskName,
        notes,
        projects: [ASANA_PROJECT_GID],
      },
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error("Asana error:", err);
    return res.status(502).json({ error: "Asana task creation failed", detail: err });
  }

  const { data } = await resp.json();
  console.log("Created Asana task", data.gid, "for ticket:", taskName);
  return res.status(200).json({ status: "ok", task_gid: data.gid });
}
