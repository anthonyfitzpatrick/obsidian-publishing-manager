/**
 * DST-002 conservative profile seeds reviewed 2026-07-19 against official publisher/help pages.
 * Requirements deliberately stay generic and editable because exact portal rules change.
 */
export interface BundledPlatformProfile {
  readonly slug: string;
  readonly label: string;
  readonly officialUrl: string;
  readonly requirements: readonly string[];
}
const common = [
  'Confirm metadata and identifiers',
  'Confirm content and cover assets',
  'Confirm territory rights',
  'Confirm pricing where applicable',
  'Review in the official portal manually'
];
const PROFILE_SEEDS = [
  ['amazon-kdp', 'Amazon KDP', 'https://kdp.amazon.com/en_US/help/topic/G202172740'],
  [
    'ingramspark',
    'IngramSpark',
    'https://www.ingramspark.com/blog/how-to-set-up-a-title-with-ingramspark-part-1'
  ],
  ['draft2digital', 'Draft2Digital', 'https://www.draft2digital.com/knowledge-base/'],
  [
    'kobo-writing-life',
    'Kobo Writing Life',
    'https://kobowritinglife.zendesk.com/hc/en-us/articles/360058975732-Setting-up-a-New-eBook'
  ],
  ['google-play-books', 'Google Play Books', 'https://support.google.com/books/partner/'],
  ['apple-books', 'Apple Books', 'https://help.apple.com/itc/bookspublisher/en.lproj/static.html'],
  [
    'storytel',
    'Storytel',
    'https://publishersupport.storytel.com/hc/en-us/articles/16417858142876-Technical-criteria-and-Delivery-Guide'
  ],
  ['bookbeat', 'BookBeat', 'https://www.bookbeat.com/uk/about'],
  ['publit', 'Publit', 'https://get.publit.com/en-SE'],
  ['bod', 'BoD', 'https://www.bod.com/'],
  ['goodreads', 'Goodreads', 'https://www.goodreads.com/author/program'],
  [
    'libraries',
    'Libraries / ONIX',
    'https://www.loc.gov/preservation/digital/formats/fdd/fdd000488.shtml'
  ]
] as const;
export const BUNDLED_PLATFORM_PROFILES: readonly BundledPlatformProfile[] = PROFILE_SEEDS.map(
  ([slug, label, officialUrl]) => ({ slug, label, officialUrl, requirements: common })
);
