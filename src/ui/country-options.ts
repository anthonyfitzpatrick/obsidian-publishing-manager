/**
 * Supplies a single, searchable country vocabulary for publisher territories. Values are stored
 * as ISO-style two-letter codes, but the interface always presents the reader with country names.
 */

export interface CountryOption {
  readonly code: string;
  readonly label: string;
}

/** A default publisher can apply everywhere; it is deliberately the first selectable territory. */
export const GLOBAL_COUNTRY_OPTION: CountryOption = { code: 'GLOBAL', label: 'Global' };

/** The ISO 3166-1 countries supported by Publishing Manager territory records. */
const COUNTRY_CODES = `AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO OM PK PW PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VA VE VN YE ZM ZW`.split(' ');

/** Resolves English display names locally; a code remains a safe fallback on older runtimes. */
const regionNames =
  typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : undefined;

export const COUNTRY_OPTIONS: readonly CountryOption[] = [
  GLOBAL_COUNTRY_OPTION,
  ...COUNTRY_CODES.map((code) => ({ code, label: regionNames?.of(code) ?? code })).sort((left, right) =>
    left.label.localeCompare(right.label)
  )
];

/** Converts a typed code or a selected “Country (CC)” search result into the canonical code. */
export function countryCodeFromSearch(value: string): string | undefined {
  const trimmed = value.trim();
  const codeMatch = trimmed.match(/\(([A-Za-z]{2})\)$/u);
  const candidate = (codeMatch?.[1] ?? trimmed).toUpperCase();
  if (candidate === 'GLOBAL') return 'GLOBAL';
  if (/^[A-Z]{2}$/u.test(candidate) && COUNTRY_OPTIONS.some((option) => option.code === candidate)) return candidate;
  const normalized = trimmed.toLocaleLowerCase();
  return COUNTRY_OPTIONS.find((option) => option.label.toLocaleLowerCase() === normalized)?.code;
}

/** Formats existing canonical records and the native datalist options consistently. */
export function countrySearchLabel(code: string): string {
  const option = COUNTRY_OPTIONS.find((candidate) => candidate.code === code);
  return option === undefined ? code : `${option.label} (${option.code})`;
}
