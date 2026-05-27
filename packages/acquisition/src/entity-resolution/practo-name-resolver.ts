export interface HospitalSeedForPracto {
  hospitalName: string;
  city?: string;
  locality?: string;
  address?: string;
  phone?: string;
  website?: string;
}

export interface PractoClinicCandidate {
  clinicName?: string;
  clinicAddress?: string;
  city?: string;
  locality?: string;
  profileUrl?: string;
  doctorName?: string;
  specialty?: string;
}

export interface PractoNameResolutionResult {
  confidence: number;
  status: 'matched' | 'possible_match' | 'weak_match' | 'rejected';
  reasons: string[];
  warnings: string[];
}

function normalizeText(value?: string): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function removeHospitalNoise(value: string): string {
  return value
    .replace(/\b(private|pvt|ltd|limited|llp|llc|inc)\b/g, ' ')
    .replace(/\b(hospital|hospitals|clinic|clinics|medical|centre|center|healthcare|health care|institute|diagnostic|diagnostics)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): Set<string> {
  const stopWords = new Set([
    'the',
    'and',
    'of',
    'for',
    'in',
    'at',
    'near',
    'branch',
    'unit',
  ]);

  return new Set(
    value
      .split(' ')
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !stopWords.has(token)),
  );
}

function tokenJaccard(a: string, b: string): number {
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);

  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) intersection += 1;
  }

  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function containsAllImportantTokens(seedName: string, candidateName: string): boolean {
  const seedTokens = [...tokenize(removeHospitalNoise(normalizeText(seedName)))];
  const candidateTokens = tokenize(removeHospitalNoise(normalizeText(candidateName)));

  const importantTokens = seedTokens.filter((token) => token.length >= 4);

  if (importantTokens.length === 0) return false;

  return importantTokens.every((token) => candidateTokens.has(token));
}

function partialTokenOverlap(seedName: string, candidateName: string): number {
  const seedTokens = [...tokenize(removeHospitalNoise(normalizeText(seedName)))];
  const candidateTokens = tokenize(removeHospitalNoise(normalizeText(candidateName)));

  if (seedTokens.length === 0 || candidateTokens.size === 0) return 0;

  const matched = seedTokens.filter((token) => candidateTokens.has(token)).length;
  return matched / seedTokens.length;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function resolvePractoClinicMatch(
  seed: HospitalSeedForPracto,
  candidate: PractoClinicCandidate,
): PractoNameResolutionResult {
  const reasons: string[] = [];
  const warnings: string[] = [];

  const seedHospitalName = normalizeText(seed.hospitalName);
  const seedHospitalNameNoNoise = removeHospitalNoise(seedHospitalName);

  const candidateClinicName = normalizeText(candidate.clinicName);
  const candidateClinicNameNoNoise = removeHospitalNoise(candidateClinicName);

  const seedCity = normalizeText(seed.city);
  const candidateCity = normalizeText(candidate.city);

  const seedLocality = normalizeText(seed.locality);
  const candidateLocality = normalizeText(candidate.locality);

  const seedAddress = normalizeText(seed.address);
  const candidateAddress = normalizeText(candidate.clinicAddress);

  let score = 0;

  const rawNameSimilarity = tokenJaccard(seedHospitalName, candidateClinicName);
  const noiseRemovedNameSimilarity = tokenJaccard(seedHospitalNameNoNoise, candidateClinicNameNoNoise);
  const overlap = partialTokenOverlap(seed.hospitalName, candidate.clinicName ?? '');

  const nameScore = Math.max(rawNameSimilarity, noiseRemovedNameSimilarity, overlap * 0.85);

  score += nameScore * 0.55;

  if (nameScore >= 0.8) {
    reasons.push('Strong hospital/clinic name token match');
  } else if (nameScore >= 0.55) {
    reasons.push('Moderate hospital/clinic name token match');
  } else if (nameScore > 0) {
    reasons.push('Weak hospital/clinic name token overlap');
  }

  if (containsAllImportantTokens(seed.hospitalName, candidate.clinicName ?? '')) {
    score += 0.08;
    reasons.push('Candidate contains all important hospital name tokens');
  }

  if (seedCity && candidateCity) {
    if (seedCity === candidateCity) {
      score += 0.18;
      reasons.push('City matched');
    } else if (candidateAddress.includes(seedCity)) {
      score += 0.12;
      reasons.push('Seed city found in candidate address');
    } else {
      score -= 0.15;
      warnings.push(`City mismatch: expected "${seed.city}", got "${candidate.city}"`);
    }
  }

  if (seedLocality && candidateLocality) {
    if (seedLocality === candidateLocality) {
      score += 0.12;
      reasons.push('Locality matched');
    } else if (candidateAddress.includes(seedLocality)) {
      score += 0.08;
      reasons.push('Seed locality found in candidate address');
    } else {
      warnings.push(`Locality mismatch or unavailable: expected "${seed.locality}", got "${candidate.locality}"`);
    }
  } else if (seedLocality && candidateAddress.includes(seedLocality)) {
    score += 0.08;
    reasons.push('Seed locality found in clinic address');
  }

  if (seedAddress && candidateAddress) {
    const addressSimilarity = tokenJaccard(seedAddress, candidateAddress);
    score += addressSimilarity * 0.07;

    if (addressSimilarity >= 0.5) {
      reasons.push('Address has meaningful token overlap');
    }
  }

  if (!candidate.clinicName) {
    score -= 0.25;
    warnings.push('Candidate has no clinic/hospital name');
  }

  if (!candidate.profileUrl) {
    warnings.push('Candidate has no Practo profile URL');
  }

  const confidence = clamp01(score);

  let status: PractoNameResolutionResult['status'];

  if (confidence >= 0.78) {
    status = 'matched';
  } else if (confidence >= 0.58) {
    status = 'possible_match';
  } else if (confidence >= 0.35) {
    status = 'weak_match';
  } else {
    status = 'rejected';
  }

  return {
    confidence,
    status,
    reasons,
    warnings,
  };
}
