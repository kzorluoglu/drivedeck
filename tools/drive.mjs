#!/usr/bin/env node
// Drive simulator for the emulator: follows a real OSRM route and feeds one GPS fix per second,
// including speed, into the running emulator.
//
//   node tools/drive.mjs                                   Hauingen -> Lörrach Bahnhof
//   node tools/drive.mjs 47.6363,7.6782 47.6143,7.6628     custom start and destination (lat,lng)
//   node tools/drive.mjs --speed 1.5                       drive 50 % faster than the road speeds
import { execFileSync } from 'node:child_process';

const SERIAL = process.env.SERIAL || 'emulator-5554';
const KNOTS_PER_MPS = 1.943844;
const EARTH_RADIUS = 6371000;

const args = process.argv.slice(2);
const speedIndex = args.indexOf('--speed');
const speedFactor = speedIndex >= 0 ? Number(args.splice(speedIndex, 2)[1]) : 1;
const [from = '47.6363,7.6782', to = '47.6143,7.6628'] = args;
const parse = (s) => s.split(',').map(Number);

function distance([lat1, lng1], [lat2, lng2]) {
  const toRad = (d) => (d * Math.PI) / 180;
  const x = toRad(lng2 - lng1) * Math.cos(toRad((lat1 + lat2) / 2));
  return Math.hypot(x, toRad(lat2 - lat1)) * EARTH_RADIUS;
}

function sendFix([lat, lng], mps) {
  execFileSync('adb', ['-s', SERIAL, 'emu', 'geo', 'fix', String(lng), String(lat), '300', '10', (mps * KNOTS_PER_MPS).toFixed(2)]);
}

const [a, b] = [parse(from), parse(to)];
const url = `https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}`
  + '?overview=full&geometries=geojson&annotations=speed';
const route = (await (await fetch(url)).json()).routes[0];
const points = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
const speeds = route.legs[0].annotation.speed;
console.log(`route ${(route.distance / 1000).toFixed(1)} km, about ${Math.round(route.duration / 60)} min`);

// walk the polyline one second at a time, easing between the per-segment road speeds
let segment = 0;
let offset = 0;
let mps = 0;
while (segment < points.length - 1) {
  const target = Math.min(speeds[segment] * speedFactor, 40);
  mps += Math.max(-3, Math.min(2, target - mps));   // roughly +2 m/s² accelerating, -3 m/s² braking
  let step = mps;
  while (step > 0 && segment < points.length - 1) {
    const length = distance(points[segment], points[segment + 1]);
    if (offset + step < length) {
      offset += step;
      step = 0;
    } else {
      step -= length - offset;
      offset = 0;
      segment++;
    }
  }
  const [p, q] = [points[segment], points[Math.min(segment + 1, points.length - 1)]];
  const length = distance(p, q) || 1;
  const t = offset / length;
  const position = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  sendFix(position, mps);
  process.stdout.write(`\r${(mps * 3.6).toFixed(0).padStart(3)} km/h  ${position[0].toFixed(5)}, ${position[1].toFixed(5)}   `);
  await new Promise((r) => setTimeout(r, 1000));
}
sendFix(points[points.length - 1], 0);
console.log('\narrived');
