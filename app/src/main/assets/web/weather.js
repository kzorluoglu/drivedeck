(function () {
  'use strict';

  // Weather from Open-Meteo (free, no key). Shows the temperature at the top of the map and answers
  // the assistant's questions for here, the destination or any place.
  const { $ } = window.core;
  const API = 'https://api.open-meteo.com/v1/forecast';
  const REFRESH_MS = 15 * 60 * 1000;
  const MOVED_M = 15000;

  // WMO weather codes
  const CODES = [
    [[0], 'klar', '☀️'],
    [[1, 2], 'heiter bis wolkig', '🌤️'],
    [[3], 'bedeckt', '☁️'],
    [[45, 48], 'Nebel', '🌫️'],
    [[51, 53, 55, 56, 57], 'Nieselregen', '🌦️'],
    [[61, 63, 65, 66, 67, 80, 81, 82], 'Regen', '🌧️'],
    [[71, 73, 75, 77, 85, 86], 'Schnee', '🌨️'],
    [[95, 96, 99], 'Gewitter', '⛈️'],
  ];

  function describe(code) {
    const entry = CODES.find(([codes]) => codes.includes(code));
    return entry ? { text: entry[1], icon: entry[2] } : { text: 'unbekannt', icon: '' };
  }

  async function forecast(lat, lng) {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lng,
      current: 'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m',
      hourly: 'temperature_2m,precipitation_probability,weather_code',
      forecast_days: '2',
      timezone: 'auto',
      timeformat: 'unixtime',
    });
    const response = await fetch(`${API}?${params}`, { signal: AbortSignal.timeout(15000) });
    return response.json();
  }

  /**
   * Weather now, and optionally in some hours. Returns a short object for the assistant.
   */
  async function at(lat, lng, hoursAhead) {
    let data;
    try {
      data = await forecast(lat, lng);
    } catch (e) {
      return { error: 'Wetterdienst nicht erreichbar' };
    }
    const now = describe(data.current.weather_code);
    const result = {
      now: `${Math.round(data.current.temperature_2m)} °C, ${now.text}, gefühlt ${Math.round(data.current.apparent_temperature)} °C, Wind ${Math.round(data.current.wind_speed_10m)} km/h`,
    };
    if (hoursAhead > 0) {
      const target = Date.now() / 1000 + hoursAhead * 3600;
      let best = 0;
      data.hourly.time.forEach((t, i) => {
        if (Math.abs(t - target) < Math.abs(data.hourly.time[best] - target)) {
          best = i;
        }
      });
      const later = describe(data.hourly.weather_code[best]);
      result.later = `${Math.round(data.hourly.temperature_2m[best])} °C, ${later.text}, Regenwahrscheinlichkeit ${data.hourly.precipitation_probability[best]} %`;
      result.inHours = Math.round(hoursAhead * 10) / 10;
    }
    return result;
  }

  window.core.weather = { at };

  // header chip, refreshed every 15 minutes and when the car moved far
  const chip = $('weather');
  let lastFix = null;
  let lastAt = 0;

  async function refresh(lat, lng) {
    lastAt = Date.now();
    lastFix = [lat, lng];
    try {
      const data = await forecast(lat, lng);
      const now = describe(data.current.weather_code);
      chip.textContent = `${now.icon} ${Math.round(data.current.temperature_2m)}°`;
      chip.title = now.text;
    } catch (e) {
      // keep the old value
    }
  }

  window.addEventListener('gps', (e) => {
    const { latitude, longitude } = e.detail;
    const moved = lastFix ? Math.hypot((latitude - lastFix[0]) * 111000, (longitude - lastFix[1]) * 75000) : Infinity;
    if (Date.now() - lastAt > REFRESH_MS || moved > MOVED_M) {
      refresh(latitude, longitude);
    }
  });
})();
