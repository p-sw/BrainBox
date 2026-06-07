export function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function formatDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function formatMonthKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export function nextDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
}

export function nextMonth(d: Date): {
  year: number;
  month: number;
  daysInMonth: number;
} {
  const year = d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear();
  const month = (d.getMonth() + 1) % 12;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return { year, month, daysInMonth };
}
