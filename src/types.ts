export interface Task {
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
  /** Thi công: đánh dấu từ nhân viên — xanh khi hoàn thành, đỏ khi chưa (kể cả bài lùi ngày). */
  constructionMark?: 'completed' | 'incomplete';
}

export interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar?: string;
}

export type UserRole = 'admin' | 'employee';

export type ViewType = 'dashboard' | 'tasks' | 'employees' | 'schedule';
