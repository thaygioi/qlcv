import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { google } from 'googleapis';

type TaskRow = {
  id: string;
  title: string;
  description: string;
  assignedTo: string;
  priority: 'low' | 'medium' | 'high';
  status: 'todo' | 'in-progress' | 'completed';
  dueDate: string;
  createdAt: string;
  category?: 'construction' | 'design' | 'production';
  contact?: string;
  workplace?: string;
  manpower?: string;
  vehicle?: string;
};

type ContactItem = { id: string; name: string; phone?: string };

type StatePayload = {
  tasks: TaskRow[];
  employees: string[];
  vehicles: string[];
  contacts: ContactItem[];
};

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

function requireEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

function parseServiceAccountJson(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON must be valid JSON (one-line).');
  }
}

function getSheetsClient() {
  const sheetId = requireEnv('GOOGLE_SHEET_ID', SHEET_ID);
  const sa = parseServiceAccountJson(requireEnv('GOOGLE_SERVICE_ACCOUNT_JSON', SERVICE_ACCOUNT_JSON));

  const auth = new google.auth.GoogleAuth({
    credentials: sa,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  return { sheets, sheetId };
}

const TAB_TASKS = 'tasks';
const TAB_EMPLOYEES = 'employees';
const TAB_VEHICLES = 'vehicles';
const TAB_CONTACTS = 'contacts';

const HEADERS = {
  [TAB_TASKS]: [
    'id',
    'title',
    'description',
    'assignedTo',
    'priority',
    'status',
    'dueDate',
    'createdAt',
    'category',
    'contact',
    'workplace',
    'manpower',
    'vehicle',
  ],
  [TAB_EMPLOYEES]: ['name'],
  [TAB_VEHICLES]: ['name'],
  [TAB_CONTACTS]: ['id', 'name', 'phone'],
} as const;

async function ensureTabsAndHeaders() {
  const { sheets, sheetId } = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const existing = new Set((meta.data.sheets ?? []).map((s) => s.properties?.title).filter(Boolean) as string[]);
  const need = [TAB_TASKS, TAB_EMPLOYEES, TAB_VEHICLES, TAB_CONTACTS].filter((t) => !existing.has(t));

  if (need.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: need.map((title) => ({ addSheet: { properties: { title } } })),
      },
    });
  }

  // Write headers to row 1 (overwrite row 1 only)
  for (const [tab, headers] of Object.entries(HEADERS)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tab}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }
}

function rowToTask(headers: string[], row: any[]): TaskRow | null {
  const obj: any = {};
  headers.forEach((h, i) => {
    obj[h] = row[i];
  });
  if (!obj.id || !obj.title) return null;
  return {
    id: String(obj.id),
    title: String(obj.title ?? ''),
    description: String(obj.description ?? ''),
    assignedTo: String(obj.assignedTo ?? 'admin'),
    priority: (obj.priority as any) || 'medium',
    status: (obj.status as any) || 'todo',
    dueDate: String(obj.dueDate ?? ''),
    createdAt: String(obj.createdAt ?? ''),
    category: obj.category ? (String(obj.category) as any) : undefined,
    contact: obj.contact ? String(obj.contact) : undefined,
    workplace: obj.workplace ? String(obj.workplace) : undefined,
    manpower: obj.manpower ? String(obj.manpower) : undefined,
    vehicle: obj.vehicle ? String(obj.vehicle) : undefined,
  };
}

async function readTab(tab: string) {
  const { sheets, sheetId } = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${tab}!A:Z` });
  const values = (res.data.values ?? []) as any[][];
  if (values.length === 0) return { headers: [], rows: [] as any[][] };
  const [headers, ...rows] = values;
  return { headers: headers.map(String), rows };
}

async function writeTab(tab: string, headers: string[], rows: any[][]) {
  const { sheets, sheetId } = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${tab}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers, ...rows] },
  });
}

async function readState(): Promise<StatePayload> {
  await ensureTabsAndHeaders();

  const [tasksTab, employeesTab, vehiclesTab, contactsTab] = await Promise.all([
    readTab(TAB_TASKS),
    readTab(TAB_EMPLOYEES),
    readTab(TAB_VEHICLES),
    readTab(TAB_CONTACTS),
  ]);

  const tasksHeaders = tasksTab.headers.length ? tasksTab.headers : [...HEADERS[TAB_TASKS]];
  const tasks = tasksTab.rows
    .map((r) => rowToTask(tasksHeaders, r))
    .filter(Boolean) as TaskRow[];

  const employees = employeesTab.rows.map((r) => String(r[0] ?? '')).filter(Boolean);
  const vehicles = vehiclesTab.rows.map((r) => String(r[0] ?? '')).filter(Boolean);

  const contactsHeaders = contactsTab.headers.length ? contactsTab.headers : [...HEADERS[TAB_CONTACTS]];
  const contacts = contactsTab.rows
    .map((r) => {
      const obj: any = {};
      contactsHeaders.forEach((h, i) => (obj[h] = r[i]));
      if (!obj.id || !obj.name) return null;
      return { id: String(obj.id), name: String(obj.name), phone: obj.phone ? String(obj.phone) : undefined } satisfies ContactItem;
    })
    .filter(Boolean) as ContactItem[];

  return { tasks, employees, vehicles, contacts };
}

async function writeState(state: StatePayload) {
  await ensureTabsAndHeaders();

  const taskHeaders = [...HEADERS[TAB_TASKS]];
  const taskRows = state.tasks.map((t) => [
    t.id,
    t.title,
    t.description ?? '',
    t.assignedTo ?? 'admin',
    t.priority ?? 'medium',
    t.status ?? 'todo',
    t.dueDate ?? '',
    t.createdAt ?? '',
    t.category ?? '',
    t.contact ?? '',
    t.workplace ?? '',
    t.manpower ?? '',
    t.vehicle ?? '',
  ]);

  const employeesHeaders = [...HEADERS[TAB_EMPLOYEES]];
  const employeesRows = state.employees.map((name) => [name]);

  const vehiclesHeaders = [...HEADERS[TAB_VEHICLES]];
  const vehiclesRows = state.vehicles.map((name) => [name]);

  const contactsHeaders = [...HEADERS[TAB_CONTACTS]];
  const contactsRows = state.contacts.map((c) => [c.id, c.name, c.phone ?? '']);

  await Promise.all([
    writeTab(TAB_TASKS, taskHeaders, taskRows),
    writeTab(TAB_EMPLOYEES, employeesHeaders, employeesRows),
    writeTab(TAB_VEHICLES, vehiclesHeaders, vehiclesRows),
    writeTab(TAB_CONTACTS, contactsHeaders, contactsRows),
  ]);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/state', async (_req, res) => {
  try {
    const state = await readState();
    res.json(state);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'Unknown error' });
  }
});

app.put('/api/state', async (req, res) => {
  try {
    const body = req.body as Partial<StatePayload>;
    const state: StatePayload = {
      tasks: Array.isArray(body.tasks) ? (body.tasks as any) : [],
      employees: Array.isArray(body.employees) ? (body.employees as any) : [],
      vehicles: Array.isArray(body.vehicles) ? (body.vehicles as any) : [],
      contacts: Array.isArray(body.contacts) ? (body.contacts as any) : [],
    };
    await writeState(state);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'Unknown error' });
  }
});

const port = Number(process.env.PORT || 5173);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Sheets API server listening on http://localhost:${port}`);
});

