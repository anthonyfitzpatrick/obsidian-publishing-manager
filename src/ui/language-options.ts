/**
 * Centralizes the reviewed language vocabulary used by Project creation and editing. Stored values
 * remain compact BCP 47 tags, while every user-facing control presents the full language name.
 * Keeping regional variants separate lets a Project say both “English” and “British English”.
 */

export interface RegionalLanguageOption {
  readonly code: string;
  readonly label: string;
}

export interface PrimaryLanguageOption {
  readonly code: string;
  readonly label: string;
  readonly regions: readonly RegionalLanguageOption[];
}

/** Twenty widely used world languages, with common publishing-oriented regional variants. */
export const PRIMARY_LANGUAGE_OPTIONS: readonly PrimaryLanguageOption[] = [
  { code: 'en', label: 'English', regions: [{ code: 'en-US', label: 'US English' }, { code: 'en-GB', label: 'British English' }, { code: 'en-AU', label: 'Australian English' }, { code: 'en-CA', label: 'Canadian English' }, { code: 'en-IN', label: 'Indian English' }] },
  { code: 'zh', label: 'Chinese', regions: [{ code: 'zh-CN', label: 'Simplified Chinese (China)' }, { code: 'zh-TW', label: 'Traditional Chinese (Taiwan)' }, { code: 'zh-HK', label: 'Traditional Chinese (Hong Kong)' }] },
  { code: 'hi', label: 'Hindi', regions: [{ code: 'hi-IN', label: 'Indian Hindi' }] },
  { code: 'es', label: 'Spanish', regions: [{ code: 'es-ES', label: 'European Spanish' }, { code: 'es-MX', label: 'Mexican Spanish' }, { code: 'es-US', label: 'US Spanish' }, { code: 'es-AR', label: 'Argentine Spanish' }] },
  { code: 'fr', label: 'French', regions: [{ code: 'fr-FR', label: 'French (France)' }, { code: 'fr-CA', label: 'Canadian French' }, { code: 'fr-BE', label: 'Belgian French' }, { code: 'fr-CH', label: 'Swiss French' }] },
  { code: 'ar', label: 'Arabic', regions: [{ code: 'ar-SA', label: 'Arabic (Saudi Arabia)' }, { code: 'ar-EG', label: 'Arabic (Egypt)' }, { code: 'ar-AE', label: 'Arabic (United Arab Emirates)' }] },
  { code: 'bn', label: 'Bengali', regions: [{ code: 'bn-BD', label: 'Bengali (Bangladesh)' }, { code: 'bn-IN', label: 'Bengali (India)' }] },
  { code: 'pt', label: 'Portuguese', regions: [{ code: 'pt-BR', label: 'Brazilian Portuguese' }, { code: 'pt-PT', label: 'European Portuguese' }] },
  { code: 'ru', label: 'Russian', regions: [{ code: 'ru-RU', label: 'Russian (Russia)' }] },
  { code: 'ur', label: 'Urdu', regions: [{ code: 'ur-PK', label: 'Urdu (Pakistan)' }, { code: 'ur-IN', label: 'Urdu (India)' }] },
  { code: 'id', label: 'Indonesian', regions: [{ code: 'id-ID', label: 'Indonesian (Indonesia)' }] },
  { code: 'de', label: 'German', regions: [{ code: 'de-DE', label: 'German (Germany)' }, { code: 'de-AT', label: 'Austrian German' }, { code: 'de-CH', label: 'Swiss German' }] },
  { code: 'ja', label: 'Japanese', regions: [{ code: 'ja-JP', label: 'Japanese (Japan)' }] },
  { code: 'pa', label: 'Punjabi', regions: [{ code: 'pa-IN', label: 'Punjabi (India)' }, { code: 'pa-PK', label: 'Punjabi (Pakistan)' }] },
  { code: 'mr', label: 'Marathi', regions: [{ code: 'mr-IN', label: 'Marathi (India)' }] },
  { code: 'te', label: 'Telugu', regions: [{ code: 'te-IN', label: 'Telugu (India)' }] },
  { code: 'tr', label: 'Turkish', regions: [{ code: 'tr-TR', label: 'Turkish (Türkiye)' }] },
  { code: 'ta', label: 'Tamil', regions: [{ code: 'ta-IN', label: 'Tamil (India)' }, { code: 'ta-LK', label: 'Tamil (Sri Lanka)' }] },
  { code: 'vi', label: 'Vietnamese', regions: [{ code: 'vi-VN', label: 'Vietnamese (Vietnam)' }] },
  { code: 'ko', label: 'Korean', regions: [{ code: 'ko-KR', label: 'Korean (South Korea)' }] }
];

/** Reads legacy compound language values without losing their regional specificity on first edit. */
export function splitLanguageSelection(value: string, regionalValue?: string): {
  readonly primary: string;
  readonly regional: string;
} {
  const normalized = value.trim();
  const primary = normalized.split('-')[0]?.toLowerCase() ?? 'en';
  const legacyRegional = normalized.includes('-') ? normalized : '';
  return { primary, regional: regionalValue?.trim() || legacyRegional };
}

/** Produces the readable label used in controls while retaining unknown legacy codes verbatim. */
export function primaryLanguageLabel(code: string): string {
  return PRIMARY_LANGUAGE_OPTIONS.find((option) => option.code === code)?.label ?? `Other (${code})`;
}

/** Retrieves the regional vocabulary only for the selected primary language. */
export function regionalLanguageOptions(primary: string): readonly RegionalLanguageOption[] {
  return PRIMARY_LANGUAGE_OPTIONS.find((option) => option.code === primary)?.regions ?? [];
}

