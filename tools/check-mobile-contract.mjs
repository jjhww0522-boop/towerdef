import { mkdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import core from '../dist/server/core/index.js';
import protocol from '../dist/server/protocol.js';
import geometry from '../dist/shared/battle-geometry.js';

// Exercise the actual C# DTO/model sources. This is not a Unity or iPhone build.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'artifacts/mobile-contract');
await mkdir(output, { recursive: true });
const cases = [];
for (const id of [0, ...core.content.battlefields.map(field => field.id)]) {
  const game = core.createGame({ seed: 27, playerIds: ['mobile'], battlefieldId: id || 1, tutorial: id === 0 });
  const state = protocol.publicState(game);
  const layout = geometry.getBattlefieldLayout(id);
  const points = [];
  for (let routeIndex = 0; routeIndex < layout.routes.length; routeIndex++) {
    for (const progress of [-.2, 0, .1, .25, .5, .85, 1, 1.2]) {
      points.push({ routeIndex, progress, ...geometry.enemyPoint(progress, id, routeIndex) });
    }
  }
  cases.push({ battlefieldId: id, state, points });
}
const modGame = core.createGame({ seed: 27, playerIds: ['mobile', 'peer'], battlefieldId: 1 });
const fieldModStates = [];
const snapshot = () => fieldModStates.push(structuredClone(protocol.publicState(modGame)));
modGame.tick = 400; modGame.wave = 5; snapshot();
assert.equal(core.applyAction(modGame, 'mobile', { seq: 1, type: 'choose_mod', offerId: 'survey', modId: 'tracker' }).ok, true);
snapshot();
modGame.tick = 800; modGame.wave = 9; snapshot();
assert.equal(core.applyAction(modGame, 'mobile', { seq: 2, type: 'choose_mod', offerId: 'retune', modId: 'opener' }).ok, true);
assert.equal(core.applyAction(modGame, 'mobile', { seq: 3, type: 'leave' }).ok, true);
modGame.tick = 1000; snapshot(); // A teammate continues while the personal result stays fixed.
await writeFile(join(output, 'fixtures.json'), JSON.stringify({ content: protocol.publicContent(), cases, fieldModStates }));
const xml = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const source = relative => xml(resolve(root, relative));
await writeFile(join(output, 'MobileContracts.csproj'), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0</TargetFramework><IsTestProject>true</IsTestProject><EnableDefaultCompileItems>false</EnableDefaultCompileItems><Nullable>disable</Nullable></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.11.1" />
    <PackageReference Include="NUnit" Version="3.13.3" />
    <PackageReference Include="NUnit3TestAdapter" Version="4.6.0" />
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <Compile Include="${source('client/Assets/Scripts/Protocol.cs')}" />
    <Compile Include="${source('client/Assets/Scripts/MobileModel.cs')}" />
    <Compile Include="${source('client/Assets/Tests/Editor/MobileModelTests.cs')}" />
    <Compile Include="${source('tests/mobile-contract/ServerFixturesTests.cs')}" />
  </ItemGroup>
</Project>\n`);
let dotnet = process.env.TOWERDEF_DOTNET;
if (!dotnet) {
  const bundled = join(root, 'artifacts/mobile-sdk/dotnet', process.platform === 'win32' ? 'dotnet.exe' : 'dotnet');
  try { await access(bundled); dotnet = bundled; } catch { dotnet = 'dotnet'; }
}
const result = spawnSync(dotnet, ['test', join(output, 'MobileContracts.csproj'), '--nologo', '--verbosity', 'minimal', '--logger', 'trx;LogFileName=mobile-contract.trx'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1',
    DOTNET_CLI_HOME: join(output, 'cli-home'), NUGET_PACKAGES: join(output, 'packages'), TOWERDEF_CONTRACT_FIXTURES: join(output, 'fixtures.json') }
});
if (result.error) console.error('A .NET 8 SDK is required. Set TOWERDEF_DOTNET to its executable. ' + result.error.message);
await writeFile(join(output, 'report.json'), JSON.stringify({ source: 'portable_csharp_contract_tests',
  contentVersion: core.content.version, passed: result.status === 0, unityEditorRun: false, actualDevices: 0, actualParticipants: 0 }, null, 2));
process.exitCode = result.status === 0 ? 0 : 1;
