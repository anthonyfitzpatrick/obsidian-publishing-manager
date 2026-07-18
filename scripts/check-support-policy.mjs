import { readFile } from 'node:fs/promises';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const [manifest, versions, packageJson, policy, nvmrc] = await Promise.all([
  readJson('manifest.json'),
  readJson('versions.json'),
  readJson('package.json'),
  readJson('support-policy.json'),
  readFile('.nvmrc', 'utf8')
]);

const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const minimumAppVersion = policy.obsidian.minimumAppVersion;
const nodeMajor = String(policy.toolchain.nodeMajor);

expect(
  manifest.minAppVersion === minimumAppVersion,
  `manifest.json minAppVersion must be ${minimumAppVersion}`
);
expect(manifest.isDesktopOnly === false, 'manifest.json must remain mobile-compatible');
expect(
  versions[manifest.version] === minimumAppVersion,
  `versions.json must map ${manifest.version} to ${minimumAppVersion}`
);
expect(
  packageJson.engines?.node === `>=${nodeMajor}.0.0`,
  `package.json engines.node must be >=${nodeMajor}.0.0`
);
expect(nvmrc.trim() === nodeMajor, `.nvmrc must select Node ${nodeMajor}`);
expect(
  typeof packageJson.devDependencies?.obsidian === 'string',
  'package.json must pin Obsidian API types'
);
expect(policy.runtime.nodeApis === false, 'production Node APIs must remain unsupported');
expect(policy.runtime.electronApis === false, 'production Electron APIs must remain unsupported');
expect(policy.runtime.networkApis === false, 'production network APIs must remain unsupported');

if (failures.length > 0) {
  console.error('Support policy check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(
  `Support policy check passed: Obsidian ${minimumAppVersion}+ on desktop/mobile; Node ${nodeMajor} build baseline.`
);
