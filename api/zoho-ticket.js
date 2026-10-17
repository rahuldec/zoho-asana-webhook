const ASANA_TOKEN = process.env.ASANA_TOKEN;
const ASANA_API = "https://app.asana.com/api/1.0";
const ASANA_PROJECT_GID = process.env.ASANA_PROJECT_GID || "1219498756334922";
const ASANA_WORKSPACE_GID = process.env.ASANA_WORKSPACE_GID || "480944584143449";
const TICKET_SENDER = "wecare@okiedokiepay.com";
const GSHEET_ID = process.env.GSHEET_ID || "1p4Hw00tmNfhXlDmljIixoAt5ZNAESWbj";

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

function parseCSV(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const cols = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { cols.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    cols.push(cur.trim());
    rows.push(cols);
  }
  return rows;
}

async function lookupAssigneeName(instituteName) {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${GSHEET_ID}/gviz/tq?tqx=out:csv&sheet=Clients`;
    const r = await fetch(url);
    if (!r.ok) { console.error("Sheet fetch failed:", r.status); return null; }
    const rows = parseCSV(await r.text());
    const needle = instituteName.toLowerCase().trim();
    for (let i = 1; i < rows.length; i++) {
      const clientName = (rows[i][1] || "").replace(/^"|"$/g, "").toLowerCase().trim();
      if (!clientName) continue;
      if (clientName === needle || needle.includes(clientName) || clientName.includes(needle)) {
        const team = (rows[i][7] || "").replace(/^"|"$/g, "").trim();
        return team || null;
      }
    }
  } catch (e) {
    console.error("Sheet lookup error:", e.message);
  }
  return null;
}

async function findAsanaUserGid(name) {
  if (!name) return null;
  try {
    const r = await fetch(`${ASANA_API}/users?workspace=${ASANA_WORKSPACE_GID}&opt_fields=name,gid`, {
      headers: { Authorization: `Bearer ${ASANA_TOKEN}` },
    });
    const users = ((await r.json().catch(() => ({}))).data || []);
    const needle = name.toLowerCase().trim();
    const match = users.find(u => u.name.toLowerCase().trim() === needle);
    if (match) return match.gid;
    console.log("No Asana user found for name:", name);
  } catch (e) {
    console.error("Asana user lookup error:", e.message);
  }
  return null;
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

  // Auto-assign based on client→team mapping in Google Sheet
  const assigneeName = await lookupAssigneeName(taskName);
  const assigneeGid = await findAsanaUserGid(assigneeName);
  if (assigneeName) {
    console.log(`Assignee lookup for "${taskName}": ${assigneeName} → GID ${assigneeGid || "not found"}`);
  }

  const taskData = { name: taskName, notes, projects: [ASANA_PROJECT_GID] };
  if (assigneeGid) taskData.assignee = assigneeGid;

  const resp = await fetch(`${ASANA_API}/tasks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ASANA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ data: taskData }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error("Asana error:", err);
    return res.status(502).json({ error: "Asana task creation failed", detail: err });
  }

  const { data } = await resp.json();
  console.log("Created Asana task", data.gid, "for ticket:", taskName, assigneeGid ? `assigned to ${assigneeName}` : "(unassigned)");
  return res.status(200).json({ status: "ok", task_gid: data.gid, assignee: assigneeName || null });
}
