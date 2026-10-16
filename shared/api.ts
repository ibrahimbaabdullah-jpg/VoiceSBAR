// JSON shapes exchanged between the browser and the /api functions.

export type Role = 'admin' | 'user';

export interface PublicUser {
  id: number;
  username: string;
  role: Role;
  enhanceAllowed: boolean;
}

export interface UsageSummary {
  daySeconds: number;
  dayLimitSeconds: number;
  monthSeconds: number;
  monthLimitSeconds: number;
  enhanceToday: number;
  enhanceDailyLimit: number;
  /** Day and month keys in the server's usage time zone, e.g. "2026-10-15" and "2026-10". */
  day: string;
  month: string;
  timeZone: string;
}

export interface Features {
  enhancementAvailable: boolean;
  keytermsAvailable: boolean;
  maxRecordingSeconds: number;
  maxUploadBytes: number;
  pricing: { audioPerHourUsd: number; keytermsPerHourUsd: number };
}

export interface MeResponse {
  user: PublicUser;
  usage: UsageSummary;
  features: Features;
}

export interface SetupStatus {
  needsSetup: boolean;
  setupCodeConfigured: boolean;
  version: string;
}

export type EnhancementStatus =
  | 'off'
  | 'applied'
  | 'unchanged'
  | 'rejected'
  | 'unavailable'
  | 'failed';

export interface EnhancementResult {
  status: EnhancementStatus;
  message?: string;
}

export interface TranscribeResponse {
  /** Text to show: the AI-cleaned text when it was applied, otherwise the raw transcript. */
  text: string;
  rawText: string;
  languageCode: string | null;
  languageProbability: number | null;
  durationSeconds: number;
  keytermsUsed: number;
  enhancement: EnhancementResult;
  usage: UsageSummary;
}

export interface EnhanceResponse {
  text: string;
  enhancement: EnhancementResult;
  usage: UsageSummary;
}

export interface VocabularyResponse {
  terms: string[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; retryable?: boolean; details?: unknown };
}

export interface AdminUserRow {
  id: number;
  username: string;
  role: Role;
  disabled: boolean;
  enhanceAllowed: boolean;
  dailyLimitSeconds: number;
  monthlyLimitSeconds: number;
  customDailyLimit: boolean;
  customMonthlyLimit: boolean;
  daySeconds: number;
  monthSeconds: number;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface AdminInviteRow {
  id: number;
  kind: 'signup' | 'reset';
  role: Role;
  targetUsername: string | null;
  note: string | null;
  dailyLimitSeconds: number | null;
  monthlyLimitSeconds: number | null;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  usedByUsername: string | null;
}

export interface AdminOverview {
  day: string;
  month: string;
  timeZone: string;
  dayAudioSeconds: number;
  monthAudioSeconds: number;
  monthKeytermSeconds: number;
  dayRequests: number;
  dayErrors: number;
  monthEnhanceRequests: number;
  globalDailyLimitSeconds: number;
  globalMonthlyLimitSeconds: number;
  estimatedMonthCostUsd: number;
  users: number;
  providers: { elevenlabsConfigured: boolean; enhancementConfigured: boolean; enhanceModel: string };
}

export interface CreatedCode {
  code: string;
  expiresAt: number;
}
