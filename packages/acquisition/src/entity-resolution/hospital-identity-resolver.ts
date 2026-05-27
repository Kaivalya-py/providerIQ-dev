export function resolveHospitalIdentity(_name: string, _city?: string): { confidence: number; resolvedName: string } {
  return { confidence: 0.9, resolvedName: _name };
}
