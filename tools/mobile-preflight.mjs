import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const PINNED_EDITOR = '6000.3.24f1';
const probe = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 5000, windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : null;
};

// Inspect only tool locations and public version metadata. Never launch Unity,
// enumerate devices, inspect credentials, or read the game's profile files.
export function mobilePreflight() {
  const projectVersion = readFileSync(join(root, 'client/ProjectSettings/ProjectVersion.txt'), 'utf8')
    .match(/^m_EditorVersion:\s*(\S+)/m)?.[1] || null;
  const candidates = process.platform === 'darwin' ? [
    '/Applications/Unity/Hub/Editor/' + PINNED_EDITOR + '/Unity.app/Contents/MacOS/Unity',
    '/Applications/Unity/Unity.app/Contents/MacOS/Unity'
  ] : process.platform === 'win32' ? [
    'C:/Program Files/Unity/Hub/Editor/' + PINNED_EDITOR + '/Editor/Unity.exe',
    'C:/Program Files/Unity/Editor/Unity.exe'
  ] : [];
  const explicit = process.env.UNITY_EDITOR_PATH;
  const editor = explicit || candidates.find(path => existsSync(path)) || null;
  const editorFound = !!editor && existsSync(editor);
  let installedVersion = null;
  if (editorFound && process.platform === 'darwin') {
    const plist = join(dirname(editor), '../Info.plist');
    if (existsSync(plist)) installedVersion = probe('/usr/bin/plutil', ['-extract', 'CFBundleVersion', 'raw', '-o', '-', plist]);
  }
  // A versioned installation path is a discovery hint, not proof of a compiled build.
  const pinnedLocation = editorFound && editor.replaceAll('\\', '/').split('/').includes(PINNED_EDITOR);
  const iosSupport = editorFound && (process.platform === 'darwin'
    ? existsSync(join(dirname(editor), '../PlaybackEngines/iOSSupport'))
    : existsSync(join(dirname(editor), 'Data/PlaybackEngines/iOSSupport')));
  const xcodeVersionText = process.platform === 'darwin' ? probe('/usr/bin/xcodebuild', ['-version']) : null;
  const xcodeVersion = xcodeVersionText?.match(/^Xcode\s+([\d.]+)/m)?.[1] || null;
  const bundledDotnet = join(root, 'artifacts/mobile-sdk/dotnet', process.platform === 'win32' ? 'dotnet.exe' : 'dotnet');
  // Presence only: dotnet first-run initialization can write files, so do not execute it.
  const dotnetFound = existsSync(bundledDotnet);
  const reasons = [];
  if (process.platform !== 'darwin') reasons.push('local_ios_build_requires_macos');
  if (projectVersion !== PINNED_EDITOR) reasons.push('project_editor_pin_mismatch');
  if (!editorFound) reasons.push('unity_editor_not_found');
  else if (installedVersion ? installedVersion !== PINNED_EDITOR : !pinnedLocation) reasons.push('unity_editor_version_not_confirmed');
  if (!iosSupport) reasons.push('unity_ios_support_not_found');
  if (!xcodeVersion) reasons.push('xcode_not_confirmed');
  return {
    platform: process.platform, architecture: process.arch,
    projectEditorVersion: projectVersion, requiredEditorVersion: PINNED_EDITOR,
    unity: { found: editorFound, source: explicit ? 'UNITY_EDITOR_PATH' : editor ? 'standard_installation' : 'not_found',
      installedVersion, pinnedLocation, iosSupportFound: !!iosSupport },
    xcode: { found: !!xcodeVersion, version: xcodeVersion },
    portableContracts: { bundledDotnetFound: dotnetFound, unityCompilationValidated: false },
    iosToolchainDiscovered: reasons.length === 0, blockers: reasons,
    signingValidated: false, unityProjectCompiled: false, physicalDeviceValidated: false,
    actualDevices: 0, actualParticipants: 0
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const unknown = process.argv.slice(2).filter(arg => arg !== '--require-ios');
  if (unknown.length) { console.error('Usage: node tools/mobile-preflight.mjs [--require-ios]'); process.exitCode = 2; }
  else {
    const report = mobilePreflight();
    console.log(JSON.stringify(report, null, 2));
    if (process.argv.includes('--require-ios') && !report.iosToolchainDiscovered) process.exitCode = 1;
  }
}
