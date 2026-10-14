const ASANA_TOKEN = process.env.ASANA_TOKEN;
const ASANA_PROJECT_GID = process.env.ASANA_PROJECT_GID || "1219498756334922";
const TICKET_SENDER = "wecare@okiedokiepay.com";

function stripHtml(html) {
  return (html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>.*?<\/a>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractTableFields(html) {
  const fields = {};
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const cells = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      cells.push(stripHtml(cellMatch[1]).trim());
    }
    if (cells.length >= 3 && cells[1].trim() === ":") {
      const key = cells[0].trim();
      const val = cells[2].trim();
      if (key) fields[key] = val;
    }
  }
  return fields;
}

function extractRefNumber(html) {
  const match = html.match(/reference number[^<]*is[^<]*<b>([\d-]+)<\/b>/i);
  return match ? match[1] : null;
}

function buildNotes(body) {
  const { fromAddress, html, summary, hasAttachment, sender } = body;

  if (!html) return summary || `From: ${fromAddress}`;

  const fields = extractTableFields(html);
  const ref = extractRefNumber(html);

  const fieldOrder = [
    "Ticket ID",
    "Institute Name",
    "User Name",
    "Phone",
    "Email",
    "Call received from",
    "Query Type",
    "Module",
    "Request Description",
    "Screenshot/Documents",
    "Priority",
    "Status",
  ];

  const lines = [];
  lines.push(`From: ${sender || fromAddress}`);
  if (ref) lines.push(`Reference: ${ref}`);
  lines.push("");
  lines.push("-----------------------------");

  for (const key of fieldOrder) {
    if (fields[key] !== undefined) {
      lines.push(`${key}: ${fields[key] || "(empty)"}`);
    }
  }

  // Any extra fields not in the known list
  for (const [key, val] of Object.entries(fields)) {
    if (!fieldOrder.includes(key)) {
      lines.push(`${key}: ${val || "(empty)"}`);
    }
  }

  lines.push("-----------------------------");

  // Edit response URL
  const urlMatch = html.match(/href="(https:\/\/data\.odpay\.in[^"]+)"/i);
  if (urlMatch) lines.push(`\nEdit Response: ${urlMatch[1]}`);

  if (hasAttachment === "Yes") {
    lines.push("\n[This email has attachments — check Zoho Mail]");
  }

  return lines.join("\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ status: "ok" });
  }

  let body = req.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const { fromAddress, subject } = body;

  if ((fromAddress || "").toLowerCase().trim() !== TICKET_SENDER) {
    return res.status(200).json({ status: "ignored", reason: "sender not whitelisted" });
  }

  const fields = extractTableFields(body.html || "");
  const taskName = fields["Institute Name"] || subject || "(No Subject)";
  const notes = buildNotes(body);

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
