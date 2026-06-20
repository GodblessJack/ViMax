export function validateArrayData(data: unknown, label: string): unknown[] {
  if (!Array.isArray(data)) {
    console.warn(`[ViMax] ${label}: expected array, got ${typeof data}`, data)
    return []
  }
  return data
}
