// Fronty pro stránku Stav: co v importech čeká na Drběnu, co skončilo chybou, a kolik zpráv čeká na index hledání.
import { overduePending } from "../mailin/pending.js";
import { SCHOOL_LIST } from "../skola/sources.js";

export const QUEUES = [
  { table: "import_items", label: "Munipolis", page: "/redakce/munipolis" },
  { table: "football_items", label: "Fotbal", page: "/redakce/fotbal" },
  { table: "denik_items", label: "Jičínský deník", page: "/redakce/denik" },
  ...SCHOOL_LIST.map((source) => ({ table: source.itemsTable, label: source.page, page: `/redakce/${source.tag}` })),
];

async function countQueue(env, queue) {
  try {
    const rows = await env.DB.prepare(`select status, count(*) as n from ${queue.table} where status in ('nove', 'chyba') group by status`).all();
    const by = Object.fromEntries((rows.results ?? []).map((row) => [String(row.status), Number(row.n)]));
    return { ...queue, waiting: by.nove ?? 0, failed: by.chyba ?? 0 };
  } catch {
    return { ...queue, waiting: 0, failed: 0 };
  }
}

async function countSearchQueue(env) {
  try {
    const row = await env.DB.prepare("select count(*) as n from search_queue").first();
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

export async function loadQueues(env) {
  const [queues, search, mail] = await Promise.all([Promise.all(QUEUES.map((queue) => countQueue(env, queue))), countSearchQueue(env), overduePending(env)]);
  return { queues, search, mail };
}
