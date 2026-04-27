#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { input, select, checkbox } from "@inquirer/prompts";
import XLSX from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, ".env");

function loadEnv() {
  if (!existsSync(ENV_PATH)) return {};
  const lines = readFileSync(ENV_PATH, "utf-8").split("\n");
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

function saveEnv(env) {
  const content = Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  writeFileSync(ENV_PATH, content + "\n", "utf-8");
}

async function pdFetch(apiKey, path, params = {}) {
  const url = new URL(`https://api.pagerduty.com${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      v.forEach((item) => url.searchParams.append(`${k}[]`, item));
    } else {
      url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Token token=${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PagerDuty API ${res.status}: ${body}`);
  }
  return res.json();
}

async function pdFetchAll(apiKey, path, collectionKey, params = {}) {
  const items = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const data = await pdFetch(apiKey, path, { ...params, limit, offset });
    items.push(...(data[collectionKey] || []));
    if (!data.more) break;
    offset += limit;
  }
  return items;
}

async function getApiKey() {
  const env = loadEnv();
  if (env.PAGERDUTY_API_KEY) {
    console.log("Using stored PagerDuty API key from .env\n");
    return env.PAGERDUTY_API_KEY;
  }
  const key = await input({
    message: "Enter your PagerDuty API key (will be saved to .env):",
    validate: (v) => (v.trim().length > 0 ? true : "API key is required"),
  });
  env.PAGERDUTY_API_KEY = key.trim();
  saveEnv(env);
  console.log("API key saved to .env\n");
  return env.PAGERDUTY_API_KEY;
}

async function main() {
  console.log("\n=== PagerDuty Notes Gatherer ===\n");

  const apiKey = await getApiKey();

  const groupBy = await select({
    message: "Group notes by:",
    choices: [
      { name: "Service", value: "service" },
      { name: "Team", value: "team" },
    ],
  });

  console.log(`\nFetching ${groupBy}s from PagerDuty...`);

  let entities;
  if (groupBy === "service") {
    entities = await pdFetchAll(apiKey, "/services", "services");
  } else {
    entities = await pdFetchAll(apiKey, "/teams", "teams");
  }

  if (!entities.length) {
    console.error(`No ${groupBy}s found in this PagerDuty instance.`);
    process.exit(1);
  }

  entities.sort((a, b) => a.name.localeCompare(b.name));

  const selected = await checkbox({
    message: `Select ${groupBy}s to gather notes from (Space to toggle, Enter to confirm):`,
    choices: entities.map((e) => ({ name: e.name, value: e.id })),
    required: true,
    pageSize: 20,
  });

  if (!selected.length) {
    console.error("No selection made. Exiting.");
    process.exit(1);
  }

  const userCache = {};
  async function getUserName(userId) {
    if (!userId) return "Unknown";
    if (userCache[userId]) return userCache[userId];
    try {
      const data = await pdFetch(apiKey, `/users/${userId}`);
      userCache[userId] = data.user?.name || data.user?.email || userId;
    } catch {
      userCache[userId] = userId;
    }
    return userCache[userId];
  }

  const wb = XLSX.utils.book_new();
  const entityMap = Object.fromEntries(entities.map((e) => [e.id, e.name]));
  let totalNotes = 0;

  for (let i = 0; i < selected.length; i++) {
    const entityId = selected[i];
    const entityName = entityMap[entityId] || entityId;
    console.log(
      `\nAnalysing ${i + 1} of ${selected.length} \u2014 ${entityName}...`
    );

    const filterParam =
      groupBy === "service"
        ? { service_ids: [entityId] }
        : { team_ids: [entityId] };

    const incidents = await pdFetchAll(apiKey, "/incidents", "incidents", {
      ...filterParam,
      statuses: ["triggered", "acknowledged", "resolved"],
      date_range: "all",
    });

    console.log(`  Found ${incidents.length} incidents`);

    const rows = [];

    for (const incident of incidents) {
      let notes;
      try {
        const data = await pdFetch(
          apiKey,
          `/incidents/${incident.id}/notes`
        );
        notes = data.notes || [];
      } catch {
        notes = [];
      }

      for (const note of notes) {
        const postedBy = await getUserName(
          note.user?.id || note.user?.summary
        );
        rows.push({
          Timestamp: note.created_at || "",
          Note: note.content || "",
          "Posted By": postedBy,
          "Incident Title": incident.title || incident.summary || "",
        });
      }
    }

    rows.sort((a, b) => (a.Timestamp > b.Timestamp ? -1 : 1));
    totalNotes += rows.length;
    console.log(`  Collected ${rows.length} notes`);

    const sheetName = entityName.slice(0, 31).replace(/[\[\]*?/\\]/g, "_");
    const ws = XLSX.utils.json_to_sheet(
      rows.length
        ? rows
        : [
            {
              Timestamp: "",
              Note: "No notes found",
              "Posted By": "",
              "Incident Title": "",
            },
          ]
    );

    ws["!cols"] = [
      { wch: 25 },
      { wch: 80 },
      { wch: 25 },
      { wch: 50 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outFile = resolve(__dirname, `pagerduty-notes-${timestamp}.xlsx`);
  XLSX.writeFile(wb, outFile);

  console.log(`\n=== Done ===`);
  console.log(`Total notes collected: ${totalNotes}`);
  console.log(`File saved to: ${outFile}\n`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
