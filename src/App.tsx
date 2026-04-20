import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, LogIn, LogOut, Plus, Trash2, Truck, Upload, Users, X } from 'lucide-react';
import { INITIAL_TASKS } from './constants';
import { Task } from './types';
import { cn } from './lib/utils';
import { apiAppendEvent, apiGetState, apiLogin } from './lib/api';

const TASKS_STORAGE_KEY = 'workflow.tasks.v1';
const AUTH_STORAGE_KEY = 'workflow.auth.v1';
const EMPLOYEES_STORAGE_KEY = 'workflow.admin.employees.v1';
const VEHICLES_STORAGE_KEY = 'workflow.admin.vehicles.v1';
const CONTACTS_STORAGE_KEY = 'workflow.admin.contacts.v1';
const CLIENT_ID_KEY = 'workflow.clientId.v1';

type AuthState =
  | { role: 'employee' }
  | { role: 'admin'; username: string };

type AdminView = 'schedule' | 'employees' | 'vehicles' | 'contacts' | 'admins';

type ContactItem = {
  id: string;
  name: string;
  phone?: string;
};

function loadAuth(): AuthState {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return { role: 'employee' };
    const parsed = JSON.parse(raw) as any;
    if (parsed?.role === 'admin' && typeof parsed?.username === 'string') return { role: 'admin', username: parsed.username };
    return { role: 'employee' };
  } catch {
    return { role: 'employee' };
  }
}

function saveAuth(auth: AuthState) {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
  } catch {
    // ignore
  }
}

function safeParseArray<T>(raw: string | null): T[] | null {
  try {
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

function loadEmployees(): string[] {
  const fromStorage = safeParseArray<string>(localStorage.getItem(EMPLOYEES_STORAGE_KEY));
  if (fromStorage?.length) return fromStorage;
  return ['Tuấn Nam', 'Chì Phương', 'Thịnh Hiền'];
}

function loadVehicles(): string[] {
  const fromStorage = safeParseArray<string>(localStorage.getItem(VEHICLES_STORAGE_KEY));
  if (fromStorage?.length) return fromStorage;
  return ['Ford đen + xanh'];
}

function loadContacts(): ContactItem[] {
  const fromStorage = safeParseArray<ContactItem>(localStorage.getItem(CONTACTS_STORAGE_KEY));
  if (fromStorage?.length) return fromStorage;
  return [
    { id: 'ct_1', name: 'Ngọc Tú', phone: '0395347015' },
    { id: 'ct_2', name: 'Chang', phone: '0983966310' },
    { id: 'ct_3', name: 'Đoàn', phone: '0977740123' },
  ];
}

function saveEmployees(list: string[]) {
  try {
    localStorage.setItem(EMPLOYEES_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}
function saveVehicles(list: string[]) {
  try {
    localStorage.setItem(VEHICLES_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}
function saveContacts(list: ContactItem[]) {
  try {
    localStorage.setItem(CONTACTS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    if (!raw) return INITIAL_TASKS;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return INITIAL_TASKS;
    return parsed as Task[];
  } catch {
    return INITIAL_TASKS;
  }
}

function saveTasks(tasks: Task[]) {
  try {
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
  } catch {
    // ignore
  }
}

type NewRow = {
  category: NonNullable<Task['category']>;
  dueDate: string;
  title: string;
  contact?: string;
  workplace?: string;
  manpower?: string;
  vehicle?: string;
};

function newRowFor(date: string, category: NewRow['category']): NewRow {
  return { category, dueDate: date, title: '', contact: '', workplace: '', manpower: '', vehicle: '' };
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfWeekMonday(dateIso: string) {
  const d = new Date(`${dateIso}T00:00:00`);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day; // back to Monday
  d.setDate(d.getDate() + diff);
  return d;
}

export default function App() {
  const [auth, setAuth] = useState<AuthState>(() => loadAuth());
  const todayIso = useMemo(() => isoDate(new Date()), []);
  const [selectedDate, setSelectedDate] = useState(() => isoDate(new Date()));
  const [tasks, setTasks] = useState<Task[]>(() => loadTasks());
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const [adding, setAdding] = useState<NewRow | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  const isAdmin = auth.role === 'admin';
  const [adminView, setAdminView] = useState<AdminView>('schedule');

  const [employees, setEmployees] = useState<string[]>(() => (typeof window === 'undefined' ? [] : loadEmployees()));
  const [vehicles, setVehicles] = useState<string[]>(() => (typeof window === 'undefined' ? [] : loadVehicles()));
  const [contacts, setContacts] = useState<ContactItem[]>(() => (typeof window === 'undefined' ? [] : loadContacts()));

  const [newEmployee, setNewEmployee] = useState('');
  const [newVehicle, setNewVehicle] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [admins, setAdmins] = useState<string[]>(() => ['admin']);
  const [newAdminUsername, setNewAdminUsername] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');

  const [remoteStatus, setRemoteStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const clientId = useMemo(() => {
    try {
      const existing = localStorage.getItem(CLIENT_ID_KEY);
      if (existing) return existing;
      const created = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(CLIENT_ID_KEY, created);
      return created;
    } catch {
      return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }
  }, []);

  useEffect(() => {
    saveTasks(tasks);
  }, [tasks]);

  useEffect(() => {
    saveAuth(auth);
  }, [auth]);

  useEffect(() => {
    if (!isAdmin) setAdminView('schedule');
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) saveEmployees(employees);
  }, [employees, isAdmin]);
  useEffect(() => {
    if (isAdmin) saveVehicles(vehicles);
  }, [vehicles, isAdmin]);
  useEffect(() => {
    if (isAdmin) saveContacts(contacts);
  }, [contacts, isAdmin]);

  // Load from Google Sheet via Apps Script if configured (append-only log)
  useEffect(() => {
    const ac = new AbortController();
    setRemoteStatus('loading');
    setRemoteError(null);
    apiGetState(ac.signal)
      .then((state) => {
        if (Array.isArray(state.tasks)) setTasks(state.tasks as Task[]);
        if (Array.isArray(state.employees)) setEmployees(state.employees);
        if (Array.isArray(state.vehicles)) setVehicles(state.vehicles);
        if (Array.isArray(state.contacts)) setContacts(state.contacts as ContactItem[]);
        if (Array.isArray((state as any).admins)) setAdmins((state as any).admins);
        setRemoteStatus('idle');
      })
      .catch((e: any) => {
        setRemoteStatus('error');
        setRemoteError(e?.message ?? 'Không kết nối được Google Sheet.');
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const daily = useMemo(() => tasks.filter((t) => t.dueDate === selectedDate), [tasks, selectedDate]);
  const construction = useMemo(() => daily.filter((t) => t.category === 'construction'), [daily]);
  const design = useMemo(() => daily.filter((t) => t.category === 'design'), [daily]);
  const production = useMemo(() => daily.filter((t) => t.category === 'production'), [daily]);

  const addRow = () => {
    if (!adding) return;
    const title = adding.title.trim();
    if (!title) return;

    const task: Task = {
      id:
        editingTaskId ||
        `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      title,
      description: '',
      assignedTo: 'admin',
      priority: 'medium',
      status: 'todo',
      dueDate: adding.dueDate,
      createdAt: new Date().toISOString().slice(0, 10),
      category: adding.category,
      contact: adding.contact?.trim() || undefined,
      workplace: adding.workplace?.trim() || undefined,
      manpower: adding.manpower?.trim() || undefined,
      vehicle: adding.vehicle?.trim() || undefined,
    };

    setTasks((prev) => {
      if (editingTaskId) {
        return prev.map((t) => (t.id === editingTaskId ? { ...t, ...task } : t));
      }
      return [task, ...prev];
    });
    setAdding(null);
    setEditingTaskId(null);

    appendEvent({
      entity: 'tasks',
      action: 'upsert',
      payload: task,
      clientId,
    });
  };

  const startEditTask = (task: Task) => {
    setEditingTaskId(task.id);
    setAdminView('schedule');
    setSelectedDate(task.dueDate || selectedDate);
    setAdding({
      category: (task.category as any) || 'construction',
      dueDate: task.dueDate || selectedDate,
      title: task.title || '',
      contact: task.contact || '',
      workplace: task.workplace || '',
      manpower: task.manpower || '',
      vehicle: task.vehicle || '',
    });
  };

  const deleteTask = (taskId: string) => {
    const ok = window.confirm('Xóa công việc này?');
    if (!ok) return;
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    if (editingTaskId === taskId) {
      setEditingTaskId(null);
      setAdding(null);
    }
    appendEvent({
      entity: 'tasks',
      action: 'delete',
      payload: { id: taskId },
      clientId,
    });
  };

  const importJson = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as any;
      const maybeTasks = parsed?.tasks ?? parsed;
      if (Array.isArray(maybeTasks)) {
        setTasks(maybeTasks as Task[]);
        appendEvent({
          entity: 'tasks',
          action: 'import',
          payload: { tasks: maybeTasks },
          clientId,
        });
      }
    } catch {
      // ignore
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const appendEvent = (evt: Parameters<typeof apiAppendEvent>[0]) => {
    void apiAppendEvent(evt).catch((e: any) => {
      setRemoteStatus('error');
      setRemoteError(e?.message ?? 'Không ghi được lên Google Sheet.');
    });
  };

  const openLogin = () => {
    setLoginUsername('');
    setLoginPassword('');
    setLoginError(null);
    setIsLoginOpen(true);
  };

  const submitLogin = () => {
    const u = loginUsername.trim();
    const p = loginPassword;
    if (!u || !p) {
      setLoginError('Vui lòng nhập tài khoản và mật khẩu.');
      return;
    }
    setLoginError(null);
    setRemoteStatus('loading');
    apiLogin(u, p)
      .then((r) => {
        if (r && r.ok) {
          setAuth({ role: 'admin', username: r.username || u });
          setIsLoginOpen(false);
          appendEvent({
            entity: 'auth',
            action: 'login',
            payload: { username: r.username || u },
            clientId,
          });
          setRemoteStatus('idle');
          return;
        }
        // Fallback: allow built-in admin/admin even if login endpoint isn't deployed yet
        if (u === 'admin' && p === 'admin') {
          setAuth({ role: 'admin', username: 'admin' });
          setIsLoginOpen(false);
          appendEvent({
            entity: 'auth',
            action: 'login',
            payload: { username: 'admin' },
            clientId,
          });
          setRemoteStatus('idle');
          return;
        }
        setRemoteStatus('idle');
        setLoginError('Sai tài khoản hoặc mật khẩu.');
      })
      .catch((e: any) => {
        setRemoteStatus('idle');
        // Keep UX simple: treat as login failed (server may block CORS)
        setRemoteError(e?.message ?? 'Lỗi đăng nhập.');
        if (u === 'admin' && p === 'admin') {
          setAuth({ role: 'admin', username: 'admin' });
          setIsLoginOpen(false);
          appendEvent({
            entity: 'auth',
            action: 'login',
            payload: { username: 'admin' },
            clientId,
          });
          return;
        }
        setLoginError('Không đăng nhập được. Hãy thử lại.');
      });
  };

  const logout = () => {
    setAuth({ role: 'employee' });
    setAdding(null);
    setIsLoginOpen(false);
    appendEvent({
      entity: 'auth',
      action: 'logout',
      payload: {},
      clientId,
    });
  };

  const SectionHeader = ({ title }: { title: string }) => (
    <div className="p-4 bg-white/80 border-b border-slate-200">
      <div className="flex items-center gap-3">
        <div className="w-1.5 h-5 rounded-full bg-indigo-500" />
        <h2 className="text-sm font-black uppercase tracking-[0.24em] text-slate-900">{title}</h2>
      </div>
    </div>
  );

  const Field = ({ label, value }: { label: string; value?: string }) => (
    <div className="flex items-start justify-between gap-4">
      <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.22em]">{label}</span>
      <span className="text-xs font-bold text-slate-800 text-right leading-snug">{value?.trim() ? value : '-'}</span>
    </div>
  );

  const AdminTabs = () => (
    <div className="mt-4 flex flex-wrap gap-2">
      {(
        [
          { id: 'schedule', label: 'Lịch công việc' },
          { id: 'employees', label: 'Nhân viên' },
          { id: 'vehicles', label: 'Xe' },
          { id: 'contacts', label: 'Liên hệ' },
          { id: 'admins', label: 'Quản trị' },
        ] as const
      ).map((t) => (
        <button
          key={t.id}
          onClick={() => setAdminView(t.id)}
          className={cn(
            'px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest border shadow-sm transition-colors',
            adminView === t.id
              ? 'bg-indigo-500 border-indigo-500 text-white'
              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  const WeekPicker = () => {
    const start = startOfWeekMonday(selectedDate);
    const days = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });

    const fmtDay = new Intl.DateTimeFormat('vi-VN', { weekday: 'short' });
    const fmtDate = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' });

    return (
      <div className="mt-3">
        <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.28em] mb-2">Tuần này</div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {days.map((d) => {
            const key = isoDate(d);
            const active = key === selectedDate;
            return (
              <button
                key={key}
                onClick={() => setSelectedDate(key)}
                className={cn(
                  'shrink-0 w-20 rounded-2xl border px-3 py-2 text-left shadow-sm transition-colors',
                  active ? 'bg-indigo-500 border-indigo-500 text-white' : 'bg-white border-slate-200 text-slate-800 hover:bg-slate-50',
                )}
              >
                <div className={cn('text-[10px] font-black uppercase tracking-widest', active ? 'text-white/90' : 'text-slate-500')}>
                  {fmtDay.format(d)}
                </div>
                <div className="text-sm font-black mt-0.5">{fmtDate.format(d)}</div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const AdminListShell = ({
    title,
    icon,
    children,
  }: {
    title: string;
    icon: ReactNode;
    children: ReactNode;
  }) => (
    <div className="bg-white/70 border border-slate-200 rounded-[28px] overflow-hidden shadow-sm">
      <div className="p-4 bg-white/80 border-b border-slate-200 flex items-center gap-3">
        <div className="w-9 h-9 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
          {icon}
        </div>
        <div className="text-sm font-black uppercase tracking-[0.22em] text-slate-900">{title}</div>
      </div>
      <div className="p-4 md:p-6">{children}</div>
    </div>
  );

  return (
    <div className="min-h-screen text-slate-900">
      <div className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/70 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 py-4 md:px-8">
          <div className="flex items-start md:items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-base md:text-xl font-black tracking-tight truncate">Lịch sản xuất thi công</h1>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.32em] mt-0.5 truncate">
                Bộ phận quảng cáo
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2">
              <div className="flex items-center gap-2 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
                <Calendar className="w-4 h-4 text-slate-500" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="px-3 py-2 rounded-xl text-xs font-black bg-white border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>
              <button
                onClick={() => setSelectedDate(todayIso)}
                className={cn(
                  'inline-flex items-center gap-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl px-4 py-3 text-[10px] font-black uppercase tracking-widest transition-all shadow-sm',
                  selectedDate === todayIso && 'border-indigo-200 bg-indigo-50 text-indigo-700'
                )}
              >
                Hôm nay
              </button>

              {isAdmin ? (
                <button
                  onClick={logout}
                  className="inline-flex items-center gap-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl px-4 py-3 text-[10px] font-black uppercase tracking-widest transition-all shadow-sm"
                >
                  <LogOut className="w-4 h-4 text-slate-500" />
                  <span>Đăng xuất</span>
                </button>
              ) : (
                <button
                  onClick={openLogin}
                  className="inline-flex items-center gap-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl px-4 py-3 text-[10px] font-black uppercase tracking-widest transition-all shadow-sm"
                >
                  <LogIn className="w-4 h-4 text-slate-500" />
                  <span>Đăng nhập</span>
                </button>
              )}
            </div>
          </div>

          {(!isAdmin || adminView === 'schedule') && <WeekPicker />}

          {isAdmin && (
            <>
              <AdminTabs />

              {adminView === 'schedule' && (
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-2">
                  <button
                    onClick={() => setAdding(newRowFor(selectedDate, 'construction'))}
                    className="inline-flex items-center justify-center gap-2 bg-indigo-500 text-white px-5 py-3 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-sm hover:bg-indigo-600 active:scale-95"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Thêm dòng</span>
                  </button>

                  <button
                    onClick={() => importInputRef.current?.click()}
                    className="inline-flex items-center justify-center gap-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-900 rounded-2xl px-4 py-3 text-[10px] font-black uppercase tracking-widest transition-all shadow-sm"
                  >
                    <Upload className="w-4 h-4 text-slate-500" />
                    <span>Nhập file</span>
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void importJson(file);
                    }}
                  />
                </div>
              )}
            </>
          )}

          {remoteStatus !== 'idle' && (
            <div className="mt-3 text-xs font-bold text-slate-600">
              {remoteStatus === 'loading' && 'Đang đồng bộ từ Google Sheet...'}
              {remoteStatus === 'error' && (
                <div className="space-y-1">
                  <div>{remoteError || 'Không kết nối được Google Sheet.'}</div>
                  {(remoteError || '').toLowerCase().includes('jsonp') && (
                    <div className="text-[11px] font-semibold text-slate-600">
                      Lỗi này xảy ra khi Web App Apps Script chưa hỗ trợ JSONP. Hãy mở link test sau, nếu không ra dạng{' '}
                      <span className="font-black">cb(...)</span> thì bạn cần <span className="font-black">Triển khai → Cập nhật</span> lại.
                      <div className="mt-1">
                        <a
                          className="text-indigo-600 underline"
                          href="https://script.google.com/macros/s/AKfycbxQMHx8YRSomcNyRll6q1aCAT2bQsRjXEuL5Ap2iP7N_8Oaq0yfvLpki4BZGwd5cp7sSQ/exec?action=state&callback=cb"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Mở link test JSONP
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {isAdmin && adminView === 'schedule' && adding && (
            <div className="mt-4 bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="space-y-1">
                  <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Phân loại</div>
                  <select
                    value={adding.category}
                    onChange={(e) => setAdding((p) => (p ? { ...p, category: e.target.value as any } : p))}
                    className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="construction">Thi công</option>
                    <option value="design">Thiết kế</option>
                    <option value="production">Sản xuất</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Ngày</div>
                  <input
                    type="date"
                    value={adding.dueDate}
                    onChange={(e) => setAdding((p) => (p ? { ...p, dueDate: e.target.value } : p))}
                    className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </label>

                <label className="space-y-1 md:col-span-1">
                  <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Nội dung</div>
                  <input
                    value={adding.title}
                    onChange={(e) => setAdding((p) => (p ? { ...p, title: e.target.value } : p))}
                    placeholder="Ví dụ: Dán decal 9m2"
                    className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </label>
              </div>

              {adding.category === 'construction' && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
                  <div className="space-y-1">
                    <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Liên hệ</div>
                    <select
                      value={adding.contact ?? ''}
                      onChange={(e) => setAdding((p) => (p ? { ...p, contact: e.target.value } : p))}
                      className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="">-</option>
                      {contacts.map((c) => {
                        const label = c.phone ? `${c.name} ${c.phone}` : c.name;
                        return (
                          <option key={c.id} value={label}>
                            {label}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <input
                    value={adding.workplace ?? ''}
                    onChange={(e) => setAdding((p) => (p ? { ...p, workplace: e.target.value } : p))}
                    placeholder="Nơi làm việc"
                    className="px-4 py-3 rounded-2xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <div className="space-y-1">
                    <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Nhân lực</div>
                    <select
                      value={adding.manpower ?? ''}
                      onChange={(e) => setAdding((p) => (p ? { ...p, manpower: e.target.value } : p))}
                      className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="">-</option>
                      {employees.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Xe</div>
                    <select
                      value={adding.vehicle ?? ''}
                      onChange={(e) => setAdding((p) => (p ? { ...p, vehicle: e.target.value } : p))}
                      className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="">-</option>
                      {vehicles.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="mt-4 flex gap-3 justify-end">
                <button
                  onClick={() => setAdding(null)}
                  className="px-5 py-3 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 text-[10px] font-black uppercase tracking-widest"
                >
                  Hủy
                </button>
                <button
                  onClick={addRow}
                  disabled={!adding.title.trim()}
                  className={cn(
                    'px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all',
                    adding.title.trim()
                      ? 'bg-indigo-500 text-white hover:bg-indigo-600 shadow-sm active:scale-95'
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed',
                  )}
                >
                  {editingTaskId ? 'Cập nhật' : 'Lưu'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6">
        {isAdmin && adminView !== 'schedule' && (
          <>
            {adminView === 'employees' && (
              <AdminListShell title="Danh sách nhân viên" icon={<Users className="w-5 h-5" />}>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    value={newEmployee}
                    onChange={(e) => setNewEmployee(e.target.value)}
                    placeholder="Nhập tên nhân viên..."
                    className="flex-1 px-4 py-3 rounded-2xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <button
                    onClick={() => {
                      const name = newEmployee.trim();
                      if (!name) return;
                      setEmployees((prev) => (prev.includes(name) ? prev : [...prev, name]));
                      setNewEmployee('');
                      appendEvent({
                        entity: 'employees',
                        action: 'upsert',
                        payload: { name },
                        clientId,
                      });
                    }}
                    className="px-6 py-3 rounded-2xl bg-indigo-500 text-white hover:bg-indigo-600 text-[10px] font-black uppercase tracking-widest shadow-sm active:scale-95"
                  >
                    Thêm
                  </button>
                </div>

                <div className="mt-4 divide-y divide-slate-200 border border-slate-200 rounded-2xl overflow-hidden bg-white">
                  {employees.length === 0 ? (
                    <div className="p-4 text-slate-500 italic">Trống</div>
                  ) : (
                    employees.map((name) => (
                      <div key={name} className="p-4 flex items-center justify-between gap-4">
                        <div className="font-bold text-slate-900">{name}</div>
                        <button
                          onClick={() => {
                            setEmployees((prev) => prev.filter((x) => x !== name));
                            appendEvent({
                              entity: 'employees',
                              action: 'delete',
                              payload: { name },
                              clientId,
                            });
                          }}
                          className="p-2 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
                          aria-label="Xóa"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </AdminListShell>
            )}

            {adminView === 'vehicles' && (
              <AdminListShell title="Danh sách xe" icon={<Truck className="w-5 h-5" />}>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    value={newVehicle}
                    onChange={(e) => setNewVehicle(e.target.value)}
                    placeholder="Nhập tên xe..."
                    className="flex-1 px-4 py-3 rounded-2xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <button
                    onClick={() => {
                      const v = newVehicle.trim();
                      if (!v) return;
                      setVehicles((prev) => (prev.includes(v) ? prev : [...prev, v]));
                      setNewVehicle('');
                      appendEvent({
                        entity: 'vehicles',
                        action: 'upsert',
                        payload: { name: v },
                        clientId,
                      });
                    }}
                    className="px-6 py-3 rounded-2xl bg-indigo-500 text-white hover:bg-indigo-600 text-[10px] font-black uppercase tracking-widest shadow-sm active:scale-95"
                  >
                    Thêm
                  </button>
                </div>

                <div className="mt-4 divide-y divide-slate-200 border border-slate-200 rounded-2xl overflow-hidden bg-white">
                  {vehicles.length === 0 ? (
                    <div className="p-4 text-slate-500 italic">Trống</div>
                  ) : (
                    vehicles.map((v) => (
                      <div key={v} className="p-4 flex items-center justify-between gap-4">
                        <div className="font-bold text-slate-900">{v}</div>
                        <button
                          onClick={() => {
                            setVehicles((prev) => prev.filter((x) => x !== v));
                            appendEvent({
                              entity: 'vehicles',
                              action: 'delete',
                              payload: { name: v },
                              clientId,
                            });
                          }}
                          className="p-2 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
                          aria-label="Xóa"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </AdminListShell>
            )}

            {adminView === 'contacts' && (
              <AdminListShell title="Danh sách liên hệ" icon={<Upload className="w-5 h-5" />}>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    value={newContactName}
                    onChange={(e) => setNewContactName(e.target.value)}
                    placeholder="Tên liên hệ"
                    className="px-4 py-3 rounded-2xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <input
                    value={newContactPhone}
                    onChange={(e) => setNewContactPhone(e.target.value)}
                    placeholder="Số điện thoại (tuỳ chọn)"
                    className="px-4 py-3 rounded-2xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <button
                    onClick={() => {
                      const name = newContactName.trim();
                      const phone = newContactPhone.trim();
                      if (!name) return;
                      const item = {
                        id: `ct_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
                        name,
                        phone: phone || undefined,
                      };
                      setContacts((prev) => [
                        ...prev,
                        {
                          id: item.id,
                          name: item.name,
                          phone: item.phone,
                        },
                      ]);
                      setNewContactName('');
                      setNewContactPhone('');
                      appendEvent({
                        entity: 'contacts',
                        action: 'upsert',
                        payload: item,
                        clientId,
                      });
                    }}
                    className="px-6 py-3 rounded-2xl bg-indigo-500 text-white hover:bg-indigo-600 text-[10px] font-black uppercase tracking-widest shadow-sm active:scale-95"
                  >
                    Thêm
                  </button>
                </div>

                <div className="mt-4 divide-y divide-slate-200 border border-slate-200 rounded-2xl overflow-hidden bg-white">
                  {contacts.length === 0 ? (
                    <div className="p-4 text-slate-500 italic">Trống</div>
                  ) : (
                    contacts.map((c) => (
                      <div key={c.id} className="p-4 flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 truncate">{c.name}</div>
                          {c.phone && <div className="text-sm text-slate-600 font-semibold">{c.phone}</div>}
                        </div>
                        <button
                          onClick={() => {
                            setContacts((prev) => prev.filter((x) => x.id !== c.id));
                            appendEvent({
                              entity: 'contacts',
                              action: 'delete',
                              payload: { id: c.id },
                              clientId,
                            });
                          }}
                          className="p-2 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
                          aria-label="Xóa"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </AdminListShell>
            )}

            {adminView === 'admins' && (
              <AdminListShell title="Danh sách quản trị" icon={<Users className="w-5 h-5" />}>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    value={newAdminUsername}
                    onChange={(e) => setNewAdminUsername(e.target.value)}
                    placeholder="Tài khoản (username)"
                    className="px-4 py-3 rounded-2xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <input
                    value={newAdminPassword}
                    onChange={(e) => setNewAdminPassword(e.target.value)}
                    placeholder="Mật khẩu"
                    type="password"
                    className="px-4 py-3 rounded-2xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <button
                    onClick={() => {
                      const username = newAdminUsername.trim();
                      const password = newAdminPassword;
                      if (!username || !password) return;
                      if (username === 'admin') return;
                      setAdmins((prev) => (prev.includes(username) ? prev : [...prev, username]));
                      setNewAdminUsername('');
                      setNewAdminPassword('');
                      appendEvent({
                        entity: 'admins',
                        action: 'upsert',
                        payload: { username, password },
                        clientId,
                      });
                    }}
                    className="px-6 py-3 rounded-2xl bg-indigo-500 text-white hover:bg-indigo-600 text-[10px] font-black uppercase tracking-widest shadow-sm active:scale-95"
                  >
                    Thêm
                  </button>
                </div>

                <div className="mt-4 divide-y divide-slate-200 border border-slate-200 rounded-2xl overflow-hidden bg-white">
                  {admins.length === 0 ? (
                    <div className="p-4 text-slate-500 italic">Trống</div>
                  ) : (
                    admins
                      .sort()
                      .map((u) => (
                        <div key={u} className="p-4 flex items-center justify-between gap-4">
                          <div className="font-bold text-slate-900">{u}</div>
                          <button
                            disabled={u === 'admin'}
                            onClick={() => {
                              if (u === 'admin') return;
                              setAdmins((prev) => prev.filter((x) => x !== u));
                              appendEvent({
                                entity: 'admins',
                                action: 'delete',
                                payload: { username: u },
                                clientId,
                              });
                            }}
                            className={cn(
                              'p-2 rounded-2xl border bg-white hover:bg-slate-50',
                              u === 'admin'
                                ? 'border-slate-100 text-slate-300 cursor-not-allowed'
                                : 'border-slate-200 text-slate-600',
                            )}
                            aria-label="Xóa"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))
                  )}
                </div>
                <div className="mt-3 text-xs font-semibold text-slate-600">
                  Lưu ý: mật khẩu được lưu trong Google Sheet (events). Chỉ chia sẻ sheet cho người tin cậy.
                </div>
              </AdminListShell>
            )}
          </>
        )}

        {/* Employee view + Admin schedule view both show schedule */}
        {(!isAdmin || adminView === 'schedule') && (
          <>
            {/* THI CÔNG */}
            <section className="bg-white/70 border border-slate-200 rounded-[28px] overflow-hidden shadow-sm">
              <SectionHeader title="Thi công" />

              {/* Mobile cards */}
              <div className="md:hidden p-4 space-y-3">
                {construction.length === 0 ? (
                  <div className="px-4 py-10 text-center text-slate-500 italic bg-white rounded-2xl border border-slate-200">
                    Trống
                  </div>
                ) : (
                  construction.map((t, idx) => (
                    <div
                      key={t.id}
                      className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.22em]">
                            #{idx + 1}
                          </div>
                          <div className="text-sm font-black text-slate-900 mt-1 leading-snug break-words">
                            {t.title}
                          </div>
                        </div>
                        <div className="shrink-0 flex items-center gap-2 rounded-2xl bg-slate-50 border border-slate-200 px-3 py-2">
                          <Truck className="w-4 h-4 text-slate-500" />
                          <span className="text-[10px] font-black text-slate-700 uppercase tracking-widest">
                            {t.vehicle || '-'}
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 space-y-2">
                        <Field label="Liên hệ" value={t.contact} />
                        <Field label="Nơi làm việc" value={t.workplace} />
                        <Field label="Nhân lực" value={t.manpower} />
                      </div>

                      {isAdmin && (
                        <div className="mt-4 flex items-center justify-end gap-2">
                          <button
                            onClick={() => startEditTask(t)}
                            className="px-4 py-2 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 text-[10px] font-black uppercase tracking-widest"
                          >
                            Sửa
                          </button>
                          <button
                            onClick={() => deleteTask(t.id)}
                            className="px-4 py-2 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-rose-600 text-[10px] font-black uppercase tracking-widest"
                          >
                            Xóa
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="bg-emerald-500/15 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">
                      <th className="px-4 py-3 border-r border-slate-200 w-12 text-center">TT</th>
                      <th className="px-6 py-3 border-r border-slate-200">Nội dung công việc</th>
                      <th className="px-6 py-3 border-r border-slate-200">Liên hệ</th>
                      <th className="px-6 py-3 border-r border-slate-200">Nơi làm việc</th>
                      <th className="px-6 py-3 border-r border-slate-200">Nhân lực</th>
                      <th className="px-6 py-3">Xe</th>
                      {isAdmin && <th className="px-6 py-3 w-44 text-right">Thao tác</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {construction.length === 0 ? (
                      <tr>
                        <td colSpan={isAdmin ? 7 : 6} className="px-6 py-10 text-center text-slate-500 italic">
                          Trống
                        </td>
                      </tr>
                    ) : (
                      construction.map((t, idx) => (
                        <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-4 border-r border-slate-200 text-center font-mono text-slate-500">
                            {idx + 1}
                          </td>
                          <td className="px-6 py-4 border-r border-slate-200 font-bold text-slate-900">{t.title}</td>
                          <td className="px-6 py-4 border-r border-slate-200 text-slate-700">{t.contact || '-'}</td>
                          <td className="px-6 py-4 border-r border-slate-200 text-slate-700">{t.workplace || '-'}</td>
                          <td className="px-6 py-4 border-r border-slate-200 text-slate-700">{t.manpower || '-'}</td>
                          <td className="px-6 py-4 text-slate-700">{t.vehicle || '-'}</td>
                          {isAdmin && (
                            <td className="px-6 py-4 text-right">
                              <div className="inline-flex gap-2">
                                <button
                                  onClick={() => startEditTask(t)}
                                  className="px-4 py-2 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 text-[10px] font-black uppercase tracking-widest"
                                >
                                  Sửa
                                </button>
                                <button
                                  onClick={() => deleteTask(t.id)}
                                  className="px-4 py-2 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-rose-600 text-[10px] font-black uppercase tracking-widest"
                                >
                                  Xóa
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* THIẾT KẾ + SẢN XUẤT */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <section className="bg-white/70 border border-slate-200 rounded-[28px] overflow-hidden shadow-sm">
                <SectionHeader title="Thiết kế" />
                <div className="p-4 md:p-0">
                  {design.length === 0 ? (
                    <div className="md:hidden px-4 py-10 text-center text-slate-500 italic bg-white rounded-2xl border border-slate-200">
                      Trống
                    </div>
                  ) : (
                    <div className="md:hidden space-y-2">
                      {design.map((t, idx) => (
                        <div key={t.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.22em]">#{idx + 1}</div>
                              <div className="text-sm font-black text-slate-900 mt-1 break-words">{t.title}</div>
                            </div>
                            {isAdmin && (
                              <div className="shrink-0 flex items-center gap-2">
                                <button
                                  onClick={() => startEditTask(t)}
                                  className="px-4 py-2 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 text-[10px] font-black uppercase tracking-widest"
                                >
                                  Sửa
                                </button>
                                <button
                                  onClick={() => deleteTask(t.id)}
                                  className="px-4 py-2 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-rose-600 text-[10px] font-black uppercase tracking-widest"
                                >
                                  Xóa
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-sm border-collapse">
                      <tbody className="divide-y divide-slate-200">
                        {design.length === 0 ? (
                          <tr>
                            <td className="px-6 py-10 text-center text-slate-500 italic">Trống</td>
                          </tr>
                        ) : (
                          design.map((t) => (
                            <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                              <td className="px-6 py-4 text-slate-800 font-medium">{t.title}</td>
                              {isAdmin && (
                                <td className="px-6 py-4 text-right">
                                  <div className="inline-flex gap-2">
                                    <button
                                      onClick={() => startEditTask(t)}
                                      className="px-4 py-2 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 text-[10px] font-black uppercase tracking-widest"
                                    >
                                      Sửa
                                    </button>
                                    <button
                                      onClick={() => deleteTask(t.id)}
                                      className="px-4 py-2 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-rose-600 text-[10px] font-black uppercase tracking-widest"
                                    >
                                      Xóa
                                    </button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>

              <section className="bg-white/70 border border-slate-200 rounded-[28px] overflow-hidden shadow-sm">
                <SectionHeader title="Sản xuất" />
                <div className="p-4 md:p-0">
                  {production.length === 0 ? (
                    <div className="md:hidden px-4 py-10 text-center text-slate-500 italic bg-white rounded-2xl border border-slate-200">
                      Trống
                    </div>
                  ) : (
                    <div className="md:hidden space-y-2">
                      {production.map((t, idx) => (
                        <div key={t.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.22em]">#{idx + 1}</div>
                              <div className="text-sm font-black text-slate-900 mt-1 break-words">{t.title}</div>
                            </div>
                            {isAdmin && (
                              <div className="shrink-0 flex items-center gap-2">
                                <button
                                  onClick={() => startEditTask(t)}
                                  className="px-4 py-2 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 text-[10px] font-black uppercase tracking-widest"
                                >
                                  Sửa
                                </button>
                                <button
                                  onClick={() => deleteTask(t.id)}
                                  className="px-4 py-2 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-rose-600 text-[10px] font-black uppercase tracking-widest"
                                >
                                  Xóa
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-sm border-collapse">
                      <tbody className="divide-y divide-slate-200">
                        {production.length === 0 ? (
                          <tr>
                            <td className="px-6 py-10 text-center text-slate-500 italic">Trống</td>
                          </tr>
                        ) : (
                          production.map((t) => (
                            <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                              <td className="px-6 py-4 text-slate-800 font-medium">{t.title}</td>
                              {isAdmin && (
                                <td className="px-6 py-4 text-right">
                                  <div className="inline-flex gap-2">
                                    <button
                                      onClick={() => startEditTask(t)}
                                      className="px-4 py-2 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 text-[10px] font-black uppercase tracking-widest"
                                    >
                                      Sửa
                                    </button>
                                    <button
                                      onClick={() => deleteTask(t.id)}
                                      className="px-4 py-2 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-rose-600 text-[10px] font-black uppercase tracking-widest"
                                    >
                                      Xóa
                                    </button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            </div>
          </>
        )}
      </div>

      {/* Login modal */}
      {isLoginOpen && !isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => {
              setIsLoginOpen(false);
              setLoginError(null);
            }}
          />
          <div className="relative w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.22em]">Đăng nhập</div>
                <div className="text-lg font-black text-slate-900">Quản trị</div>
              </div>
              <button
                onClick={() => {
                  setIsLoginOpen(false);
                  setLoginError(null);
                }}
                className="p-2 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <label className="space-y-1 block">
                <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Tài khoản</div>
                <input
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  placeholder="admin"
                  autoComplete="username"
                  className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </label>

              <label className="space-y-1 block">
                <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Mật khẩu</div>
                <input
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="admin"
                  type="password"
                  autoComplete="current-password"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitLogin();
                  }}
                  className="w-full px-4 py-3 rounded-2xl bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </label>

              {loginError && <div className="text-sm font-bold text-rose-600">{loginError}</div>}
            </div>

            <div className="p-5 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setIsLoginOpen(false);
                  setLoginError(null);
                }}
                className="px-5 py-3 rounded-2xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 text-[10px] font-black uppercase tracking-widest"
              >
                Hủy
              </button>
              <button
                onClick={submitLogin}
                className="px-6 py-3 rounded-2xl bg-indigo-500 text-white hover:bg-indigo-600 text-[10px] font-black uppercase tracking-widest shadow-sm active:scale-95"
              >
                Đăng nhập
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
