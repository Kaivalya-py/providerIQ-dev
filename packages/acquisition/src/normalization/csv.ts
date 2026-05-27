export function parseCsvRows(content: string): string[][] {
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  return lines.map(line => line.split(',').map(cell => cell.trim().replace(/^"|"$/g, '')));
}

export function csvRowsToObjects(rows: string[][]): Record<string, string>[] {
  if (rows.length < 2) return [];
  const [headers, ...data] = rows;
  return data.map(row => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
    return obj;
  });
}

export function parseCsvToRecords(csv: string): Record<string, string>[] {
  return csvRowsToObjects(parseCsvRows(csv));
}
