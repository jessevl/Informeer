import { execFileSync } from 'node:child_process';
import process from 'node:process';

function getAdbPath() {
  const sdkRoot = process.env.ANDROID_SDK_ROOT || `${process.env.HOME}/Library/Android/sdk`;
  return `${sdkRoot}/platform-tools/adb`;
}

function listConnectedDevices() {
  const output = execFileSync(getAdbPath(), ['devices', '-l'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices attached'))
    .map((line) => {
      const [serial, state, ...details] = line.split(/\s+/);
      return {
        serial,
        state,
        details: details.join(' '),
      };
    })
    .filter((device) => device.state === 'device');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parsePorts(values) {
  const ports = values.length > 0 ? values : ['3000', '3011'];
  return ports.map((value) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      fail(`Invalid port: ${value}`);
    }
    return parsed;
  });
}

function resolveTargets(devices) {
  const requestedTarget = process.env.ANDROID_TARGET?.trim();
  if (requestedTarget) {
    const match = devices.find((device) => device.serial === requestedTarget);
    if (!match) {
      fail(
        [
          `ANDROID_TARGET=${requestedTarget} is not connected.`,
          devices.length > 0 ? 'Connected targets:' : 'No connected Android devices found.',
          ...devices.map((device) => `- ${device.serial} ${device.details}`.trim()),
        ].join('\n')
      );
    }

    return [match];
  }

  return devices;
}

function reversePorts(targets, ports) {
  for (const target of targets) {
    for (const port of ports) {
      execFileSync(
        getAdbPath(),
        ['-s', target.serial, 'reverse', `tcp:${port}`, `tcp:${port}`],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
    }
  }
}

const devices = listConnectedDevices();
if (devices.length === 0) {
  fail('No connected Android devices found. Start an emulator or connect a device, then run the command again.');
}

const ports = parsePorts(process.argv.slice(2));
const targets = resolveTargets(devices);
reversePorts(targets, ports);

for (const target of targets) {
  console.log(`Configured adb reverse for ${target.serial}: ${ports.join(', ')}`);
}