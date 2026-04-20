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

function printDeviceList(devices) {
  for (const device of devices) {
    console.log(`${device.serial}\t${device.details}`.trim());
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const devices = listConnectedDevices();
const requestedTarget = process.env.ANDROID_TARGET?.trim();
const listMode = process.argv.includes('--list');

if (listMode) {
  if (devices.length === 0) {
    console.log('No connected Android devices found.');
    process.exit(0);
  }

  printDeviceList(devices);
  process.exit(0);
}

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

  process.stdout.write(`--target ${match.serial}`);
  process.exit(0);
}

if (devices.length === 0) {
  fail('No connected Android devices found. Start an emulator or connect a device, then run the command again.');
}

if (devices.length > 1) {
  fail(
    [
      'Multiple Android targets are connected. Re-run with ANDROID_TARGET set to one of these serials:',
      ...devices.map((device) => `- ${device.serial} ${device.details}`.trim()),
      'Example: ANDROID_TARGET=emulator-5554 npm run android:dev',
    ].join('\n')
  );
}

process.stdout.write(`--target ${devices[0].serial}`);
