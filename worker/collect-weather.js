#!/usr/bin/env node
/**
 * ODDLY Weather Data Collector
 *
 * Collects historical weather data for all fixtures using Open-Meteo API.
 * Open-Meteo is free, requires NO API key, and allows 10,000 calls/day.
 *
 * For each fixture, we fetch weather at the home team's city on the match date:
 *   - temperature_2m (°C)
 *   - precipitation_sum (mm)
 *   - wind_speed_10m_max (km/h)
 *   - wind_gusts_10m_max (km/h)
 *   - relative_humidity_2m_mean (%)
 *   - cloud_cover_mean (%)
 *   - weather_code (WMO code)
 *
 * Output: data/weather-features.json
 *
 * Usage:
 *   node worker/collect-weather.js collect    # Collect weather for all fixtures
 *   node worker/collect-weather.js status     # Show collection status
 *   node worker/collect-weather.js upcoming   # Fetch weather for upcoming fixtures
 *   node worker/collect-weather.js stats      # Show weather stats
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// ─── Env ─────────────────────────────────────────────────────────────
function loadEnv() {
  const env = {};
  for (const l of fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').split('\n')) {
    const t = l.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ─── City Coordinates Database ───────────────────────────────────────
// Maps team names (lowercase) to { lat, lon, city, country }
// Covers all major football leagues
const CITY_DB = {
  // ─── ENGLAND ──────────────────────────────────────────────────────
  'manchester city': { lat: 53.4831, lon: -2.2004, city: 'Manchester', country: 'England' },
  'manchester united': { lat: 53.4631, lon: -2.2913, city: 'Manchester', country: 'England' },
  'liverpool': { lat: 53.4308, lon: -2.9608, city: 'Liverpool', country: 'England' },
  'everton': { lat: 53.4388, lon: -2.9664, city: 'Liverpool', country: 'England' },
  'arsenal': { lat: 51.5549, lon: -0.1084, city: 'London', country: 'England' },
  'chelsea': { lat: 51.4817, lon: -0.1910, city: 'London', country: 'England' },
  'tottenham': { lat: 51.6042, lon: -0.0662, city: 'London', country: 'England' },
  'tottenham hotspur': { lat: 51.6042, lon: -0.0662, city: 'London', country: 'England' },
  'west ham': { lat: 51.5387, lon: 0.0166, city: 'London', country: 'England' },
  'west ham united': { lat: 51.5387, lon: 0.0166, city: 'London', country: 'England' },
  'crystal palace': { lat: 51.3983, lon: -0.0856, city: 'London', country: 'England' },
  'fulham': { lat: 51.4750, lon: -0.2217, city: 'London', country: 'England' },
  'brentford': { lat: 51.4907, lon: -0.2889, city: 'London', country: 'England' },
  'wolverhampton': { lat: 52.5903, lon: -2.1306, city: 'Wolverhampton', country: 'England' },
  'wolverhampton wanderers': { lat: 52.5903, lon: -2.1306, city: 'Wolverhampton', country: 'England' },
  'wolves': { lat: 52.5903, lon: -2.1306, city: 'Wolverhampton', country: 'England' },
  'newcastle': { lat: 54.9756, lon: -1.6217, city: 'Newcastle', country: 'England' },
  'newcastle united': { lat: 54.9756, lon: -1.6217, city: 'Newcastle', country: 'England' },
  'aston villa': { lat: 52.5092, lon: -1.8847, city: 'Birmingham', country: 'England' },
  'brighton': { lat: 50.8616, lon: -0.0837, city: 'Brighton', country: 'England' },
  'brighton & hove albion': { lat: 50.8616, lon: -0.0837, city: 'Brighton', country: 'England' },
  'bournemouth': { lat: 50.7352, lon: -1.8384, city: 'Bournemouth', country: 'England' },
  'afc bournemouth': { lat: 50.7352, lon: -1.8384, city: 'Bournemouth', country: 'England' },
  'nottingham forest': { lat: 52.9399, lon: -1.1323, city: 'Nottingham', country: 'England' },
  'burnley': { lat: 53.7890, lon: -2.2303, city: 'Burnley', country: 'England' },
  'leeds united': { lat: 53.7774, lon: -1.5722, city: 'Leeds', country: 'England' },
  'leeds': { lat: 53.7774, lon: -1.5722, city: 'Leeds', country: 'England' },
  'sheffield united': { lat: 53.3703, lon: -1.4712, city: 'Sheffield', country: 'England' },
  'sheffield wednesday': { lat: 53.3725, lon: -1.4893, city: 'Sheffield', country: 'England' },
  'sunderland': { lat: 54.9144, lon: -1.3880, city: 'Sunderland', country: 'England' },
  'middlesbrough': { lat: 54.5782, lon: -1.2170, city: 'Middlesbrough', country: 'England' },
  'coventry city': { lat: 52.4055, lon: -1.5198, city: 'Coventry', country: 'England' },
  'hull city': { lat: 53.7465, lon: -0.3671, city: 'Hull', country: 'England' },
  'blackburn': { lat: 53.7240, lon: -2.4926, city: 'Blackburn', country: 'England' },
  'blackburn rovers': { lat: 53.7240, lon: -2.4926, city: 'Blackburn', country: 'England' },
  'bolton': { lat: 53.5784, lon: -2.5336, city: 'Bolton', country: 'England' },
  'bolton wanderers': { lat: 53.5784, lon: -2.5336, city: 'Bolton', country: 'England' },
  'southampton': { lat: 50.9058, lon: -1.3910, city: 'Southampton', country: 'England' },
  'norwich city': { lat: 52.6204, lon: 1.3067, city: 'Norwich', country: 'England' },
  'ipswich town': { lat: 52.0537, lon: 1.1383, city: 'Ipswich', country: 'England' },
  'ipswich': { lat: 52.0537, lon: 1.1383, city: 'Ipswich', country: 'England' },
  'millwall': { lat: 51.4853, lon: -0.0510, city: 'London', country: 'England' },
  'queens park rangers': { lat: 51.5093, lon: -0.2324, city: 'London', country: 'England' },
  'qpr': { lat: 51.5093, lon: -0.2324, city: 'London', country: 'England' },
  'swindon': { lat: 51.5558, lon: -1.7797, city: 'Swindon', country: 'England' },
  'swindon town': { lat: 51.5558, lon: -1.7797, city: 'Swindon', country: 'England' },

  // ─── SPAIN ───────────────────────────────────────────────────────
  'real madrid': { lat: 40.4531, lon: -3.6883, city: 'Madrid', country: 'Spain' },
  'barcelona': { lat: 41.3809, lon: 2.1228, city: 'Barcelona', country: 'Spain' },
  'atletico madrid': { lat: 40.4361, lon: -3.5995, city: 'Madrid', country: 'Spain' },
  'sevilla': { lat: 37.3840, lon: -5.9708, city: 'Sevilla', country: 'Spain' },
  'real betis': { lat: 37.3840, lon: -5.9683, city: 'Sevilla', country: 'Spain' },
  'real sociedad': { lat: 43.3012, lon: -1.9736, city: 'San Sebastian', country: 'Spain' },
  'villarreal': { lat: 39.9459, lon: -0.1989, city: 'Villarreal', country: 'Spain' },
  'valencia': { lat: 39.4747, lon: -0.3583, city: 'Valencia', country: 'Spain' },
  'athletic club': { lat: 43.2641, lon: -2.9494, city: 'Bilbao', country: 'Spain' },
  'athletic bilbao': { lat: 43.2641, lon: -2.9494, city: 'Bilbao', country: 'Spain' },
  'celta vigo': { lat: 42.2161, lon: -8.7424, city: 'Vigo', country: 'Spain' },
  'real valladolid': { lat: 41.6334, lon: -4.7579, city: 'Valladolid', country: 'Spain' },
  'espanyol': { lat: 41.3682, lon: 2.0789, city: 'Barcelona', country: 'Spain' },
  'mallorca': { lat: 39.5714, lon: 2.6502, city: 'Palma', country: 'Spain' },
  'real oviedo': { lat: 42.9786, lon: -5.8700, city: 'Oviedo', country: 'Spain' },
  'osasuna': { lat: 42.7948, lon: -1.6328, city: 'Pamplona', country: 'Spain' },
  'leganes': { lat: 40.3298, lon: -3.7596, city: 'Leganes', country: 'Spain' },
  'las palmas': { lat: 28.1007, lon: -15.4314, city: 'Las Palmas', country: 'Spain' },
  'alaves': { lat: 42.8360, lon: -2.6743, city: 'Vitoria', country: 'Spain' },
  'getafe': { lat: 40.3000, lon: -3.7333, city: 'Getafe', country: 'Spain' },

  // ─── GERMANY ─────────────────────────────────────────────────────
  'bayern munich': { lat: 48.2188, lon: 11.6247, city: 'Munich', country: 'Germany' },
  'bayern': { lat: 48.2188, lon: 11.6247, city: 'Munich', country: 'Germany' },
  'borussia dortmund': { lat: 51.4926, lon: 7.4519, city: 'Dortmund', country: 'Germany' },
  'dortmund': { lat: 51.4926, lon: 7.4519, city: 'Dortmund', country: 'Germany' },
  'bayer leverkusen': { lat: 51.0384, lon: 7.0023, city: 'Leverkusen', country: 'Germany' },
  'leverkusen': { lat: 51.0384, lon: 7.0023, city: 'Leverkusen', country: 'Germany' },
  'rb leipzig': { lat: 51.3461, lon: 12.3461, city: 'Leipzig', country: 'Germany' },
  'vfb stuttgart': { lat: 48.7823, lon: 9.2346, city: 'Stuttgart', country: 'Germany' },
  'vfl wolfsburg': { lat: 52.4227, lon: 10.7865, city: 'Wolfsburg', country: 'Germany' },
  'wolfsburg': { lat: 52.4227, lon: 10.7865, city: 'Wolfsburg', country: 'Germany' },
  'borussia monchengladbach': { lat: 51.1714, lon: 6.7245, city: 'Monchengladbach', country: 'Germany' },
  'eintracht frankfurt': { lat: 50.0685, lon: 8.6454, city: 'Frankfurt', country: 'Germany' },
  'frankfurt': { lat: 50.0685, lon: 8.6454, city: 'Frankfurt', country: 'Germany' },
  'werder bremen': { lat: 53.0800, lon: 8.8000, city: 'Bremen', country: 'Germany' },
  'fc augsburg': { lat: 48.3314, lon: 10.8914, city: 'Augsburg', country: 'Germany' },
  'augsburg': { lat: 48.3314, lon: 10.8914, city: 'Augsburg', country: 'Germany' },
  'vfl bochum 1848': { lat: 51.4925, lon: 7.2361, city: 'Bochum', country: 'Germany' },
  'bochum': { lat: 51.4925, lon: 7.2361, city: 'Bochum', country: 'Germany' },
  'union berlin': { lat: 52.5486, lon: 13.5725, city: 'Berlin', country: 'Germany' },
  'hertha berlin': { lat: 52.5148, lon: 13.2395, city: 'Berlin', country: 'Germany' },
  'fc koln': { lat: 50.9333, lon: 6.8750, city: 'Cologne', country: 'Germany' },
  'freiburg': { lat: 48.0225, lon: 7.8375, city: 'Freiburg', country: 'Germany' },
  'sc freiburg': { lat: 48.0225, lon: 7.8375, city: 'Freiburg', country: 'Germany' },
  'mainz': { lat: 49.9928, lon: 8.2478, city: 'Mainz', country: 'Germany' },
  'mainz 05': { lat: 49.9928, lon: 8.2478, city: 'Mainz', country: 'Germany' },
  'hoffenheim': { lat: 49.2875, lon: 8.8875, city: 'Sinsheim', country: 'Germany' },
  'st. pauli': { lat: 53.5614, lon: 10.0264, city: 'Hamburg', country: 'Germany' },
  'saint pauli': { lat: 53.5614, lon: 10.0264, city: 'Hamburg', country: 'Germany' },
  'holstein kiel': { lat: 54.3233, lon: 10.1414, city: 'Kiel', country: 'Germany' },

  // ─── ITALY ───────────────────────────────────────────────────────
  'inter milan': { lat: 45.4781, lon: 9.1240, city: 'Milan', country: 'Italy' },
  'internazionale': { lat: 45.4781, lon: 9.1240, city: 'Milan', country: 'Italy' },
  'inter': { lat: 45.4781, lon: 9.1240, city: 'Milan', country: 'Italy' },
  'ac milan': { lat: 45.4781, lon: 9.1240, city: 'Milan', country: 'Italy' },
  'milan': { lat: 45.4781, lon: 9.1240, city: 'Milan', country: 'Italy' },
  'juventus': { lat: 45.1096, lon: 7.6413, city: 'Turin', country: 'Italy' },
  'napoli': { lat: 40.8280, lon: 14.1929, city: 'Naples', country: 'Italy' },
  'as roma': { lat: 41.9341, lon: 12.4547, city: 'Rome', country: 'Italy' },
  'roma': { lat: 41.9341, lon: 12.4547, city: 'Rome', country: 'Italy' },
  'lazio': { lat: 41.9341, lon: 12.4547, city: 'Rome', country: 'Italy' },
  'ss lazio': { lat: 41.9341, lon: 12.4547, city: 'Rome', country: 'Italy' },
  'fiorentina': { lat: 43.7806, lon: 11.2823, city: 'Florence', country: 'Italy' },
  'acf fiorentina': { lat: 43.7806, lon: 11.2823, city: 'Florence', country: 'Italy' },
  'atalanta': { lat: 45.7081, lon: 9.6819, city: 'Bergamo', country: 'Italy' },
  'torino fc': { lat: 45.1096, lon: 7.6413, city: 'Turin', country: 'Italy' },
  'torino': { lat: 45.1096, lon: 7.6413, city: 'Turin', country: 'Italy' },
  'us sassuolo calcio': { lat: 44.7281, lon: 10.7281, city: 'Sassuolo', country: 'Italy' },
  'sassuolo': { lat: 44.7281, lon: 10.7281, city: 'Sassuolo', country: 'Italy' },
  'lecce': { lat: 40.3515, lon: 18.1750, city: 'Lecce', country: 'Italy' },
  'genoa': { lat: 44.4128, lon: 8.9310, city: 'Genoa', country: 'Italy' },
  'sampdoria': { lat: 44.4128, lon: 8.9310, city: 'Genoa', country: 'Italy' },
  'udinese': { lat: 46.0694, lon: 13.2364, city: 'Udine', country: 'Italy' },
  'cagliari': { lat: 39.2238, lon: 9.1217, city: 'Cagliari', country: 'Italy' },
  'bologna': { lat: 44.4949, lon: 11.3426, city: 'Bologna', country: 'Italy' },
  'parma': { lat: 44.8015, lon: 10.3279, city: 'Parma', country: 'Italy' },
  'empoli': { lat: 43.7176, lon: 10.8481, city: 'Empoli', country: 'Italy' },
  'verona': { lat: 45.4384, lon: 10.9916, city: 'Verona', country: 'Italy' },
  'hellas verona': { lat: 45.4384, lon: 10.9916, city: 'Verona', country: 'Italy' },
  'venezia': { lat: 45.4408, lon: 12.3155, city: 'Venice', country: 'Italy' },
  'monza': { lat: 45.5845, lon: 9.2744, city: 'Monza', country: 'Italy' },
  'como': { lat: 45.8081, lon: 9.0853, city: 'Como', country: 'Italy' },

  // ─── FRANCE ──────────────────────────────────────────────────────
  'paris saint-germain': { lat: 48.9244, lon: 2.3601, city: 'Paris', country: 'France' },
  'psg': { lat: 48.9244, lon: 2.3601, city: 'Paris', country: 'France' },
  'marseille': { lat: 43.2698, lon: 5.3959, city: 'Marseille', country: 'France' },
  'olympique marseille': { lat: 43.2698, lon: 5.3959, city: 'Marseille', country: 'France' },
  'lyon': { lat: 45.7654, lon: 4.9822, city: 'Lyon', country: 'France' },
  'olympique lyonnais': { lat: 45.7654, lon: 4.9822, city: 'Lyon', country: 'France' },
  'monaco': { lat: 43.7050, lon: 7.3906, city: 'Monaco', country: 'France' },
  'as monaco': { lat: 43.7050, lon: 7.3906, city: 'Monaco', country: 'France' },
  'nice': { lat: 43.7050, lon: 7.2664, city: 'Nice', country: 'France' },
  'ogc nice': { lat: 43.7050, lon: 7.2664, city: 'Nice', country: 'France' },
  'lille': { lat: 50.6292, lon: 3.0573, city: 'Lille', country: 'France' },
  'losc lille': { lat: 50.6292, lon: 3.0573, city: 'Lille', country: 'France' },
  'rennes': { lat: 48.1034, lon: -1.6723, city: 'Rennes', country: 'France' },
  'stade rennais': { lat: 48.1034, lon: -1.6723, city: 'Rennes', country: 'France' },
  'strasbourg': { lat: 48.5569, lon: 7.7689, city: 'Strasbourg', country: 'France' },
  'montpellier': { lat: 43.6108, lon: 3.8376, city: 'Montpellier', country: 'France' },
  'nantes': { lat: 47.2558, lon: -1.5244, city: 'Nantes', country: 'France' },
  'toulouse': { lat: 43.6047, lon: 1.4442, city: 'Toulouse', country: 'France' },
  'bordeaux': { lat: 44.8281, lon: -0.5792, city: 'Bordeaux', country: 'France' },
  'saint-etienne': { lat: 45.4400, lon: 4.3900, city: 'Saint-Etienne', country: 'France' },
  'reims': { lat: 49.2517, lon: 3.8286, city: 'Reims', country: 'France' },
  'brest': { lat: 48.3904, lon: -4.4861, city: 'Brest', country: 'France' },
  'lens': { lat: 50.4272, lon: 2.8328, city: 'Lens', country: 'France' },
  'ajaccio': { lat: 41.9192, lon: 8.7386, city: 'Ajaccio', country: 'France' },

  // ─── PORTUGAL ────────────────────────────────────────────────────
  'sporting cp': { lat: 38.6610, lon: -9.1631, city: 'Lisbon', country: 'Portugal' },
  'sporting': { lat: 38.6610, lon: -9.1631, city: 'Lisbon', country: 'Portugal' },
  'benfica': { lat: 38.7527, lon: -9.1847, city: 'Lisbon', country: 'Portugal' },
  'sl benfica': { lat: 38.7527, lon: -9.1847, city: 'Lisbon', country: 'Portugal' },
  'porto': { lat: 41.1614, lon: -8.6314, city: 'Porto', country: 'Portugal' },
  'fc porto': { lat: 41.1614, lon: -8.6314, city: 'Porto', country: 'Portugal' },
  'braga': { lat: 41.5518, lon: -8.4229, city: 'Braga', country: 'Portugal' },
  'sc braga': { lat: 41.5518, lon: -8.4229, city: 'Braga', country: 'Portugal' },
  'vitoria de guimaraes': { lat: 41.4475, lon: -8.2863, city: 'Guimaraes', country: 'Portugal' },
  'vitoria guimaraes': { lat: 41.4475, lon: -8.2863, city: 'Guimaraes', country: 'Portugal' },

  // ─── NETHERLANDS ─────────────────────────────────────────────────
  'ajax': { lat: 52.3143, lon: 4.9419, city: 'Amsterdam', country: 'Netherlands' },
  'afc ajax': { lat: 52.3143, lon: 4.9419, city: 'Amsterdam', country: 'Netherlands' },
  'psv': { lat: 51.4403, lon: 5.4660, city: 'Eindhoven', country: 'Netherlands' },
  'psv eindhoven': { lat: 51.4403, lon: 5.4660, city: 'Eindhoven', country: 'Netherlands' },
  'feyenoord': { lat: 51.8939, lon: 4.5205, city: 'Rotterdam', country: 'Netherlands' },

  // ─── TURKEY ──────────────────────────────────────────────────────
  'galatasaray': { lat: 41.0422, lon: 28.9864, city: 'Istanbul', country: 'Turkey' },
  'fenerbahce': { lat: 40.9833, lon: 29.0333, city: 'Istanbul', country: 'Turkey' },
  'besiktas': { lat: 41.0422, lon: 28.9864, city: 'Istanbul', country: 'Turkey' },
  'trabzonspor': { lat: 40.9839, lon: 39.7178, city: 'Trabzon', country: 'Turkey' },
  'caykur rizespor': { lat: 41.0201, lon: 40.5234, city: 'Rize', country: 'Turkey' },
  'rizespor': { lat: 41.0201, lon: 40.5234, city: 'Rize', country: 'Turkey' },

  // ─── BRAZIL ──────────────────────────────────────────────────────
  'flamengo': { lat: -22.9121, lon: -43.1762, city: 'Rio de Janeiro', country: 'Brazil' },
  'fluminense': { lat: -22.8940, lon: -43.2260, city: 'Rio de Janeiro', country: 'Brazil' },
  'palmeiras': { lat: -23.5260, lon: -46.6758, city: 'Sao Paulo', country: 'Brazil' },
  'corinthians': { lat: -23.5260, lon: -46.6758, city: 'Sao Paulo', country: 'Brazil' },
  'sao paulo': { lat: -23.5260, lon: -46.6758, city: 'Sao Paulo', country: 'Brazil' },
  'internacional': { lat: -30.0325, lon: -51.2306, city: 'Porto Alegre', country: 'Brazil' },
  'gremio': { lat: -30.0325, lon: -51.2306, city: 'Porto Alegre', country: 'Brazil' },
  'cruzeiro': { lat: -19.8969, lon: -43.9694, city: 'Belo Horizonte', country: 'Brazil' },
  'atletico mineiro': { lat: -19.8969, lon: -43.9694, city: 'Belo Horizonte', country: 'Brazil' },
  'santos': { lat: -23.9608, lon: -46.3336, city: 'Santos', country: 'Brazil' },
  'botafogo': { lat: -22.9121, lon: -43.1762, city: 'Rio de Janeiro', country: 'Brazil' },
  'vasco da gama': { lat: -22.8940, lon: -43.2260, city: 'Rio de Janeiro', country: 'Brazil' },
  'bahia': { lat: -12.9714, lon: -38.5124, city: 'Salvador', country: 'Brazil' },
  'fortaleza': { lat: -3.7319, lon: -38.5267, city: 'Fortaleza', country: 'Brazil' },
  'sao Paulo': { lat: -23.5260, lon: -46.6758, city: 'Sao Paulo', country: 'Brazil' },
  'athletico paranaense': { lat: -25.4184, lon: -49.2567, city: 'Curitiba', country: 'Brazil' },
  'coritiba': { lat: -25.4184, lon: -49.2567, city: 'Curitiba', country: 'Brazil' },
  'juventude': { lat: -30.0325, lon: -51.2306, city: 'Porto Alegre', country: 'Brazil' },
  'ceara': { lat: -3.7319, lon: -38.5267, city: 'Fortaleza', country: 'Brazil' },
  'parana': { lat: -25.4184, lon: -49.2567, city: 'Curitiba', country: 'Brazil' },
  'goias': { lat: -16.6869, lon: -49.2648, city: 'Goiania', country: 'Brazil' },
  'atletico goianiense': { lat: -16.6869, lon: -49.2648, city: 'Goiania', country: 'Brazil' },
  'sport recife': { lat: -8.0476, lon: -34.8770, city: 'Recife', country: 'Brazil' },
  'sport': { lat: -8.0476, lon: -34.8770, city: 'Recife', country: 'Brazil' },
  'cuiaba': { lat: -15.6014, lon: -56.0979, city: 'Cuiaba', country: 'Brazil' },
  'america mineiro': { lat: -19.8969, lon: -43.9694, city: 'Belo Horizonte', country: 'Brazil' },
  'chapecoense': { lat: -27.1000, lon: -52.6167, city: 'Chapeco', country: 'Brazil' },

  // ─── ARGENTINA ───────────────────────────────────────────────────
  'boca juniors': { lat: -34.6356, lon: -58.3649, city: 'Buenos Aires', country: 'Argentina' },
  'river plate': { lat: -34.5454, lon: -58.4498, city: 'Buenos Aires', country: 'Argentina' },
  'racing club': { lat: -34.6680, lon: -58.5310, city: 'Avellaneda', country: 'Argentina' },
  'san lorenzo': { lat: -34.6356, lon: -58.3649, city: 'Buenos Aires', country: 'Argentina' },
  'independiente': { lat: -34.6680, lon: -58.5310, city: 'Avellaneda', country: 'Argentina' },
  'estudiantes': { lat: -34.8056, lon: -57.9545, city: 'La Plata', country: 'Argentina' },
  'velez sarsfield': { lat: -34.6356, lon: -58.3649, city: 'Buenos Aires', country: 'Argentina' },
  'lanus': { lat: -34.6986, lon: -58.3953, city: 'Lanus', country: 'Argentina' },
  'talleres': { lat: -31.4135, lon: -64.1818, city: 'Cordoba', country: 'Argentina' },
  'rosario central': { lat: -32.9468, lon: -60.6505, city: 'Rosario', country: 'Argentina' },
  'argentinos juniors': { lat: -34.5950, lon: -58.4670, city: 'Buenos Aires', country: 'Argentina' },
  'defensa y justicia': { lat: -34.7000, lon: -58.2800, city: 'Florencio Varela', country: 'Argentina' },
  'colon': { lat: -31.2500, lon: -61.5000, city: 'Santa Fe', country: 'Argentina' },
  'san martin': { lat: -33.0000, lon: -68.3333, city: 'Mendoza', country: 'Argentina' },

  // ─── MEXICO ──────────────────────────────────────────────────────
  'club america': { lat: 19.3029, lon: -99.1505, city: 'Mexico City', country: 'Mexico' },
  'club cruz azul': { lat: 19.3029, lon: -99.1505, city: 'Mexico City', country: 'Mexico' },
  'chivas': { lat: 20.6812, lon: -103.3515, city: 'Guadalajara', country: 'Mexico' },
  'guadalajara': { lat: 20.6812, lon: -103.3515, city: 'Guadalajara', country: 'Mexico' },
  'monterrey': { lat: 25.6714, lon: -100.3085, city: 'Monterrey', country: 'Mexico' },
  'tigres uanl': { lat: 25.6714, lon: -100.3085, city: 'Monterrey', country: 'Mexico' },

  // ─── MLS ─────────────────────────────────────────────────────────
  'inter miami': { lat: 25.9580, lon: -80.2389, city: 'Fort Lauderdale', country: 'USA' },
  'lafc': { lat: 34.0127, lon: -118.2841, city: 'Los Angeles', country: 'USA' },
  'la galaxy': { lat: 33.8644, lon: -118.3387, city: 'Los Angeles', country: 'USA' },
  'seattle sounders': { lat: 47.5952, lon: -122.3316, city: 'Seattle', country: 'USA' },
  'atlanta united': { lat: 33.7554, lon: -84.4010, city: 'Atlanta', country: 'USA' },

  // ─── SAUDI ARABIA ────────────────────────────────────────────────
  'al hilal': { lat: 24.7136, lon: 46.6753, city: 'Riyadh', country: 'Saudi Arabia' },
  'al ahli': { lat: 24.7136, lon: 46.6753, city: 'Riyadh', country: 'Saudi Arabia' },
  'al nassr': { lat: 24.7136, lon: 46.6753, city: 'Riyadh', country: 'Saudi Arabia' },

  // ─── UAE ─────────────────────────────────────────────────────────
  'al ain': { lat: 24.2075, lon: 55.8061, city: 'Al Ain', country: 'UAE' },
  'al wasl': { lat: 25.2350, lon: 55.2710, city: 'Dubai', country: 'UAE' },

  // ─── EGYPT ───────────────────────────────────────────────────────
  'al ahly': { lat: 30.0444, lon: 31.2357, city: 'Cairo', country: 'Egypt' },
  'zamalek': { lat: 30.0444, lon: 31.2357, city: 'Cairo', country: 'Egypt' },

  // ─── SOUTH AFRICA ────────────────────────────────────────────────
  'kaizer chiefs': { lat: -26.1929, lon: 28.0646, city: 'Johannesburg', country: 'South Africa' },
  'orlando pirates': { lat: -26.1929, lon: 28.0646, city: 'Johannesburg', country: 'South Africa' },
  'mamelodi sundowns': { lat: -25.7099, lon: 28.1847, city: 'Pretoria', country: 'South Africa' },

  // ─── JAPAN ───────────────────────────────────────────────────────
  'kawasaki frontale': { lat: 35.5308, lon: 139.7031, city: 'Kawasaki', country: 'Japan' },
  'yokohama f. marinos': { lat: 35.4437, lon: 139.6380, city: 'Yokohama', country: 'Japan' },
  'urawa red diamonds': { lat: 35.8617, lon: 139.6455, city: 'Saitama', country: 'Japan' },

  // ─── CHINA ───────────────────────────────────────────────────────
  'shanghai port': { lat: 31.2304, lon: 121.4737, city: 'Shanghai', country: 'China' },
  'guangzhou fc': { lat: 23.1291, lon: 113.2644, city: 'Guangzhou', country: 'China' },

  // ─── AUSTRALIA ───────────────────────────────────────────────────
  'sydney fc': { lat: -33.8688, lon: 151.2093, city: 'Sydney', country: 'Australia' },
  'melbourne victory': { lat: -37.8136, lon: 144.9631, city: 'Melbourne', country: 'Australia' },

  // ─── USA ─────────────────────────────────────────────────────────
  'nashville sc': { lat: 36.1627, lon: -86.7816, city: 'Nashville', country: 'USA' },
  'austin fc': { lat: 30.2672, lon: -97.7431, city: 'Austin', country: 'USA' },
};

// ─── Fallback: Map country to capital/football city ──────────────────
const COUNTRY_DEFAULTS = {
  'england': { lat: 52.4862, lon: -1.8904, city: 'Birmingham', country: 'England' },
  'spain': { lat: 40.4168, lon: -3.7038, city: 'Madrid', country: 'Spain' },
  'germany': { lat: 52.5200, lon: 13.4050, city: 'Berlin', country: 'Germany' },
  'italy': { lat: 45.4642, lon: 9.1900, city: 'Milan', country: 'Italy' },
  'france': { lat: 48.8566, lon: 2.3522, city: 'Paris', country: 'France' },
  'portugal': { lat: 38.7223, lon: -9.1393, city: 'Lisbon', country: 'Portugal' },
  'netherlands': { lat: 52.3676, lon: 4.9041, city: 'Amsterdam', country: 'Netherlands' },
  'turkey': { lat: 41.0082, lon: 28.9784, city: 'Istanbul', country: 'Turkey' },
  'brazil': { lat: -22.9068, lon: -43.1729, city: 'Rio de Janeiro', country: 'Brazil' },
  'argentina': { lat: -34.6037, lon: -58.3816, city: 'Buenos Aires', country: 'Argentina' },
  'mexico': { lat: 19.4326, lon: -99.1332, city: 'Mexico City', country: 'Mexico' },
  'usa': { lat: 38.9072, lon: -77.0369, city: 'Washington', country: 'USA' },
  'uae': { lat: 25.2048, lon: 55.2708, city: 'Dubai', country: 'UAE' },
  'egypt': { lat: 30.0444, lon: 31.2357, city: 'Cairo', country: 'Egypt' },
  'south africa': { lat: -26.2041, lon: 28.0473, city: 'Johannesburg', country: 'South Africa' },
  'japan': { lat: 35.6762, lon: 139.6503, city: 'Tokyo', country: 'Japan' },
  'china': { lat: 39.9042, lon: 116.4074, city: 'Beijing', country: 'China' },
  'australia': { lat: -33.8688, lon: 151.2093, city: 'Sydney', country: 'Australia' },
  'south korea': { lat: 37.5665, lon: 126.9780, city: 'Seoul', country: 'South Korea' },
  'saudi arabia': { lat: 24.7136, lon: 46.6753, city: 'Riyadh', country: 'Saudi Arabia' },
  'colombia': { lat: 4.7110, lon: -74.0721, city: 'Bogota', country: 'Colombia' },
  'chile': { lat: -33.4489, lon: -70.6693, city: 'Santiago', country: 'Chile' },
  'uruguay': { lat: -34.9011, lon: -56.1645, city: 'Montevideo', country: 'Uruguay' },
  'ecuador': { lat: -0.1807, lon: -78.4678, city: 'Quito', country: 'Ecuador' },
  'peru': { lat: -12.0464, lon: -77.0428, city: 'Lima', country: 'Peru' },
  'paraguay': { lat: -25.2637, lon: -57.5759, city: 'Asuncion', country: 'Paraguay' },
  'bolivia': { lat: -16.5000, lon: -68.1500, city: 'La Paz', country: 'Bolivia' },
  'greece': { lat: 37.9838, lon: 23.7275, city: 'Athens', country: 'Greece' },
  'belgium': { lat: 50.8503, lon: 4.3517, city: 'Brussels', country: 'Belgium' },
  'scotland': { lat: 55.8642, lon: -4.2518, city: 'Glasgow', country: 'Scotland' },
  'austria': { lat: 48.2082, lon: 16.3738, city: 'Vienna', country: 'Austria' },
  'switzerland': { lat: 47.3769, lon: 8.5417, city: 'Zurich', country: 'Switzerland' },
  'denmark': { lat: 55.6761, lon: 12.5683, city: 'Copenhagen', country: 'Denmark' },
  'sweden': { lat: 59.3293, lon: 18.0686, city: 'Stockholm', country: 'Sweden' },
  'norway': { lat: 59.9139, lon: 10.7522, city: 'Oslo', country: 'Norway' },
  'czech republic': { lat: 50.0755, lon: 14.4378, city: 'Prague', country: 'Czech Republic' },
  'croatia': { lat: 45.8150, lon: 15.9819, city: 'Zagreb', country: 'Croatia' },
  'serbia': { lat: 44.7866, lon: 20.4489, city: 'Belgrade', country: 'Serbia' },
  'poland': { lat: 52.2297, lon: 21.0122, city: 'Warsaw', country: 'Poland' },
  'romania': { lat: 44.4268, lon: 26.1025, city: 'Bucharest', country: 'Romania' },
  'ukraine': { lat: 50.4501, lon: 30.5234, city: 'Kyiv', country: 'Ukraine' },
  'israel': { lat: 31.7683, lon: 35.2137, city: 'Jerusalem', country: 'Israel' },
  'morocco': { lat: 33.9716, lon: -6.8498, city: 'Rabat', country: 'Morocco' },
  'tunisia': { lat: 36.8065, lon: 10.1815, city: 'Tunis', country: 'Tunisia' },
  'algeria': { lat: 36.7538, lon: 3.0588, city: 'Algiers', country: 'Algeria' },
  'nigeria': { lat: 9.0765, lon: 7.3986, city: 'Abuja', country: 'Nigeria' },
  'ghana': { lat: 5.6037, lon: -0.1870, city: 'Accra', country: 'Ghana' },
  'senegal': { lat: 14.7167, lon: -17.4677, city: 'Dakar', country: 'Senegal' },
  'cameroon': { lat: 3.8480, lon: 11.5021, city: 'Yaounde', country: 'Cameroon' },
  'india': { lat: 28.6139, lon: 77.2090, city: 'New Delhi', country: 'India' },
  'thailand': { lat: 13.7563, lon: 100.5018, city: 'Bangkok', country: 'Thailand' },
  'vietnam': { lat: 21.0278, lon: 105.8342, city: 'Hanoi', country: 'Vietnam' },
  'indonesia': { lat: -6.2088, lon: 106.8456, city: 'Jakarta', country: 'Indonesia' },
  'new zealand': { lat: -36.8485, lon: 174.7633, city: 'Auckland', country: 'New Zealand' },
  'canada': { lat: 45.4215, lon: -75.6972, city: 'Ottawa', country: 'Canada' },
  'ireland': { lat: 53.3498, lon: -6.2603, city: 'Dublin', country: 'Ireland' },
  'cyprus': { lat: 35.1856, lon: 33.3823, city: 'Nicosia', country: 'Cyprus' },
  'hungary': { lat: 47.4979, lon: 19.0402, city: 'Budapest', country: 'Hungary' },
};

// ─── Data ────────────────────────────────────────────────────────────
const WEATHER_PATH = path.join(__dirname, '../data/weather-features.json');
const RATE_LIMIT_MS = 120; // ~120ms between calls = ~8,300/hour (under 10K/day)

function loadWeatherData() {
  if (fs.existsSync(WEATHER_PATH)) {
    return JSON.parse(fs.readFileSync(WEATHER_PATH, 'utf8'));
  }
  return { collected_at: null, count: 0, features: {}, errors: {} };
}

function saveWeatherData(data) {
  fs.writeFileSync(WEATHER_PATH, JSON.stringify(data, null, 2));
}

// ─── City Lookup ─────────────────────────────────────────────────────
function findCity(teamName, countryName) {
  if (!teamName) return null;
  const lower = teamName.toLowerCase();

  // Direct match
  if (CITY_DB[lower]) return CITY_DB[lower];

  // Partial match
  for (const [key, val] of Object.entries(CITY_DB)) {
    if (lower.includes(key) || key.includes(lower)) return val;
  }

  // Country fallback
  if (countryName) {
    const countryLower = countryName.toLowerCase();
    if (COUNTRY_DEFAULTS[countryLower]) return COUNTRY_DEFAULTS[countryLower];
  }

  return null;
}

// ─── WMO Weather Code Description ────────────────────────────────────
function wmoDescription(code) {
  const descriptions = {
    0: 'clear', 1: 'mainly_clear', 2: 'partly_cloudy', 3: 'overcast',
    45: 'fog', 48: 'rime_fog',
    51: 'light_drizzle', 53: 'moderate_drizzle', 55: 'dense_drizzle',
    56: 'freezing_drizzle', 57: 'dense_freezing_drizzle',
    61: 'slight_rain', 63: 'moderate_rain', 65: 'heavy_rain',
    66: 'freezing_rain', 67: 'heavy_freezing_rain',
    71: 'slight_snow', 73: 'moderate_snow', 75: 'heavy_snow',
    77: 'snow_grains',
    80: 'slight_rain_showers', 81: 'moderate_rain_showers', 82: 'violent_rain_showers',
    85: 'slight_snow_showers', 86: 'heavy_snow_showers',
    95: 'thunderstorm', 96: 'thunderstorm_hail', 99: 'thunderstorm_heavy_hail',
  };
  return descriptions[code] || 'unknown';
}

// ─── Open-Meteo API Call ─────────────────────────────────────────────
async function fetchWeather(lat, lon, startDate, endDate, retries = 3) {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,rain_sum,wind_speed_10m_max,wind_gusts_10m_max,relative_humidity_2m_mean,weather_code&timezone=auto`;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        // Rate limited — wait and retry
        const waitMs = Math.pow(2, attempt + 1) * 2000;
        console.log(`    Rate limited, waiting ${waitMs / 1000}s...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      if (!res.ok) {
        if (attempt === retries - 1) return null;
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      return await res.json();
    } catch (e) {
      if (attempt === retries - 1) {
        console.error(`    Fetch error: ${e.message}`);
        return null;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return null;
}

// ─── Collect Weather for All Fixtures ────────────────────────────────
async function collectWeather() {
  console.log('=== Weather Data Collector (Open-Meteo) ===\n');

  const data = loadWeatherData();
  const startTime = Date.now();

  // Get all finished fixtures with kickoff time and league info (paginate through all)
  let fixtures = [];
  let offset = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data: page, error } = await sb
      .from('fixtures')
      .select('id, kickoff_time, home_team_id, away_team_id, leagues!inner(id, name, country)')
      .eq('status', 'finished')
      .not('home_score', 'is', null)
      .order('kickoff_time', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error || !page?.length) break;
    fixtures = fixtures.concat(page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  if (fixtures.length === 0) {
    console.log('No finished fixtures found');
    return;
  }

  console.log(`Found ${fixtures.length} finished fixtures\n`);

  // Get team names
  const teamIds = [...new Set(fixtures.flatMap(f => [f.home_team_id, f.away_team_id]))];
  const { data: teams } = await sb.from('teams').select('id, canonical_name').in('id', teamIds);
  const teamMap = {};
  for (const t of teams || []) teamMap[t.id] = t.canonical_name;

  // Get league info
  const leagueMap = {};
  for (const f of fixtures) {
    leagueMap[f.id] = f.leagues;
  }

  // Filter already collected
  const toCollect = fixtures.filter(f => !data.features[f.id]);
  console.log(`Already collected: ${fixtures.length - toCollect.length}`);
  console.log(`To collect: ${toCollect.length}\n`);

  if (toCollect.length === 0) {
    console.log('All fixtures have weather data!');
    return;
  }

  // Group by city to minimize API calls
  // For same city, we can fetch a date range instead of individual dates
  const cityGroups = {};

  for (const fixture of toCollect) {
    const homeName = teamMap[fixture.home_team_id];
    const league = leagueMap[fixture.id];
    const city = findCity(homeName, league?.country);

    if (!city) {
      data.errors[fixture.id] = { team: homeName, reason: 'no_city_mapping' };
      continue;
    }

    const cityKey = `${city.lat},${city.lon}`;
    if (!cityGroups[cityKey]) {
      cityGroups[cityKey] = { ...city, fixtures: [] };
    }
    cityGroups[cityKey].fixtures.push({
      id: fixture.id,
      date: fixture.kickoff_time.slice(0, 10),
      team: homeName,
      league: league?.name,
    });
  }

  const cityCount = Object.keys(cityGroups).length;
  console.log(`Unique cities: ${cityCount}`);
  console.log(`Fixtures to collect: ${toCollect.length - Object.keys(data.errors).length}\n`);

  // Process each city
  let processed = 0;
  let apiCalls = 0;
  const errors = [];

  for (const [cityKey, cityData] of Object.entries(cityGroups)) {
    const { lat, lon, city, country, fixtures: cityFixtures } = cityData;

    if (cityFixtures.length === 0) continue;

    // Sort fixtures by date
    cityFixtures.sort((a, b) => a.date.localeCompare(b.date));

    // Find date range
    const startDate = cityFixtures[0].date;
    const endDate = cityFixtures[cityFixtures.length - 1].date;

    // Check if we already have data for all fixtures in this city
    const uncollected = cityFixtures.filter(f => !data.features[f.id]);
    if (uncollected.length === 0) continue;

    // Fetch weather for the full date range
    process.stdout.write(`  ${city}, ${country} (${cityFixtures.length} fixtures, ${startDate} → ${endDate})... `);

    const weather = await fetchWeather(lat, lon, startDate, endDate);
    apiCalls++;

    if (!weather?.daily) {
      console.log('FAILED');
      errors.push({ city, reason: 'api_error' });
      continue;
    }

    // Map dates to weather data
    const dailyData = {};
    for (let i = 0; i < weather.daily.time?.length || 0; i++) {
      const date = weather.daily.time[i];
      dailyData[date] = {
        temp_max: weather.daily.temperature_2m_max?.[i] ?? null,
        temp_min: weather.daily.temperature_2m_min?.[i] ?? null,
        temp_mean: weather.daily.temperature_2m_mean?.[i] ?? null,
        precipitation_mm: weather.daily.precipitation_sum?.[i] ?? 0,
        rain_mm: weather.daily.rain_sum?.[i] ?? 0,
        wind_max_kmh: weather.daily.wind_speed_10m_max?.[i] ?? null,
        wind_gusts_kmh: weather.daily.wind_gusts_10m_max?.[i] ?? null,
        humidity_pct: weather.daily.relative_humidity_2m_mean?.[i] ?? null,
        weather_code: weather.daily.weather_code?.[i] ?? null,
        weather_desc: wmoDescription(weather.daily.weather_code?.[i] ?? 0),
      };
    }

    // Assign weather to each fixture
    let matched = 0;
    for (const fixture of cityFixtures) {
      const weatherData = dailyData[fixture.date];
      if (weatherData) {
        data.features[fixture.id] = {
          ...weatherData,
          city,
          country,
          lat,
          lon,
          collected_at: new Date().toISOString(),
        };
        matched++;
        processed++;
      } else {
        data.errors[fixture.id] = { team: fixture.team, reason: 'no_weather_for_date' };
      }
    }

    console.log(`${matched}/${cityFixtures.length} matched`);

    // Rate limiting
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));

    // Progress update every 50 cities
    if (apiCalls % 50 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const remaining = (toCollect.length - processed) / rate;
      console.log(`\n  Progress: ${processed}/${toCollect.length} (${apiCalls} API calls, ${remaining.toFixed(0)}s remaining)\n`);

      // Save checkpoint
      data.count = Object.keys(data.features).length;
      data.collected_at = new Date().toISOString();
      data.api_calls = apiCalls;
      saveWeatherData(data);
    }
  }

  // Final save
  data.count = Object.keys(data.features).length;
  data.collected_at = new Date().toISOString();
  data.api_calls = (data.api_calls || 0) + apiCalls;
  saveWeatherData(data);

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Collection Complete ===`);
  console.log(`  Processed: ${processed}`);
  console.log(`  API calls: ${apiCalls}`);
  console.log(`  Errors: ${errors.length + Object.keys(data.errors).length}`);
  console.log(`  Total weather records: ${data.count}`);
  console.log(`  Duration: ${duration}s`);
}

// ─── Status ──────────────────────────────────────────────────────────
async function showStatus() {
  const data = loadWeatherData();

  const { count: totalFixtures } = await sb
    .from('fixtures')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'finished');

  const { count: totalAll } = await sb
    .from('fixtures')
    .select('*', { count: 'exact', head: true });

  const collected = data.count || 0;
  const errors = Object.keys(data.errors || {}).length;

  console.log('=== Weather Collection Status ===\n');
  console.log(`  Total fixtures:        ${totalAll}`);
  console.log(`  Finished fixtures:     ${totalFixtures}`);
  console.log(`  Weather collected:     ${collected}`);
  console.log(`  Errors:                ${errors}`);
  console.log(`  Coverage:              ${totalFixtures > 0 ? ((collected / totalFixtures) * 100).toFixed(1) : 0}%`);
  console.log(`  API calls used:        ${data.api_calls || 0}`);
  console.log(`  Last collected:        ${data.collected_at || 'never'}`);

  // Sample weather data
  const sampleKeys = Object.keys(data.features || {}).slice(0, 3);
  if (sampleKeys.length > 0) {
    console.log(`\nSample records:`);
    for (const key of sampleKeys) {
      const f = data.features[key];
      console.log(`  ${f.city}, ${f.country}: ${f.temp_mean}°C, ${f.precipitation_mm}mm rain, ${f.wind_max_kmh}km/h wind, ${f.weather_desc}`);
    }
  }
}

// ─── Upcoming (forecast for next 5 days) ─────────────────────────────
async function collectUpcoming() {
  console.log('=== Upcoming Weather (Forecast) ===\n');

  const data = loadWeatherData();

  // Get upcoming fixtures
  const { data: fixtures } = await sb
    .from('fixtures')
    .select('id, kickoff_time, home_team_id, away_team_id, leagues!inner(id, name, country)')
    .eq('status', 'scheduled')
    .gte('kickoff_time', new Date().toISOString())
    .lte('kickoff_time', new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString())
    .order('kickoff_time');

  if (!fixtures?.length) {
    console.log('No upcoming fixtures in next 5 days');
    return;
  }

  // Get team names
  const teamIds = [...new Set(fixtures.flatMap(f => [f.home_team_id, f.away_team_id]))];
  const { data: teams } = await sb.from('teams').select('id, canonical_name').in('id', teamIds);
  const teamMap = {};
  for (const t of teams || []) teamMap[t.id] = t.canonical_name;

  console.log(`Found ${fixtures.length} upcoming fixtures\n`);

  let collected = 0;

  for (const fixture of fixtures) {
    const homeName = teamMap[fixture.home_team_id];
    const league = fixture.leagues;
    const city = findCity(homeName, league?.country);

    if (!city) continue;

    const date = fixture.kickoff_time.slice(0, 10);

    // Use forecast API for upcoming
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,rain_sum,wind_speed_10m_max,wind_gusts_10m_max,weather_code&timezone=auto&forecast_days=7`;

    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const weather = await res.json();

      if (!weather?.daily) continue;

      // Find the matching date
      for (let i = 0; i < weather.daily.time?.length || 0; i++) {
        if (weather.daily.time[i] === date) {
          data.features[fixture.id] = {
            temp_max: weather.daily.temperature_2m_max?.[i] ?? null,
            temp_min: weather.daily.temperature_2m_min?.[i] ?? null,
            temp_mean: weather.daily.temperature_2m_max && weather.daily.temperature_2m_min
              ? (weather.daily.temperature_2m_max[i] + weather.daily.temperature_2m_min[i]) / 2
              : null,
            precipitation_mm: weather.daily.precipitation_sum?.[i] ?? 0,
            rain_mm: weather.daily.rain_sum?.[i] ?? 0,
            wind_max_kmh: weather.daily.wind_speed_10m_max?.[i] ?? null,
            wind_gusts_kmh: weather.daily.wind_gusts_10m_max?.[i] ?? null,
            humidity_pct: null,
            weather_code: weather.daily.weather_code?.[i] ?? null,
            weather_desc: wmoDescription(weather.daily.weather_code?.[i] ?? 0),
            city: city.city,
            country: city.country,
            lat: city.lat,
            lon: city.lon,
            collected_at: new Date().toISOString(),
            source: 'forecast',
          };
          collected++;
          break;
        }
      }
    } catch {}

    await new Promise(r => setTimeout(r, 100));
  }

  data.count = Object.keys(data.features).length;
  data.collected_at = new Date().toISOString();
  saveWeatherData(data);

  console.log(`Collected forecast weather for ${collected}/${fixtures.length} upcoming fixtures`);
}

// ─── Stats ───────────────────────────────────────────────────────────
function showStats() {
  const data = loadWeatherData();
  const features = data.features || {};
  const total = Object.keys(features).length;

  if (total === 0) {
    console.log('No weather data collected yet');
    return;
  }

  console.log('=== Weather Data Stats ===\n');

  // Distribution of weather conditions
  const weatherCounts = {};
  const tempRanges = { cold: 0, cool: 0, mild: 0, warm: 0, hot: 0 };
  const rainBuckets = { dry: 0, light: 0, moderate: 0, heavy: 0 };
  const windBuckets = { calm: 0, light: 0, moderate: 0, strong: 0 };

  for (const f of Object.values(features)) {
    // Weather codes
    const desc = f.weather_desc || 'unknown';
    weatherCounts[desc] = (weatherCounts[desc] || 0) + 1;

    // Temperature
    const temp = f.temp_mean;
    if (temp !== null) {
      if (temp < 5) tempRanges.cold++;
      else if (temp < 12) tempRanges.cool++;
      else if (temp < 20) tempRanges.mild++;
      else if (temp < 28) tempRanges.warm++;
      else tempRanges.hot++;
    }

    // Rain
    const rain = f.precipitation_mm || 0;
    if (rain < 0.1) rainBuckets.dry++;
    else if (rain < 2) rainBuckets.light++;
    else if (rain < 10) rainBuckets.moderate++;
    else rainBuckets.heavy++;

    // Wind
    const wind = f.wind_max_kmh || 0;
    if (wind < 10) windBuckets.calm++;
    else if (wind < 20) windBuckets.light++;
    else if (wind < 40) windBuckets.moderate++;
    else windBuckets.strong++;
  }

  console.log(`Total records: ${total}`);
  console.log(`\nTemperature distribution:`);
  for (const [k, v] of Object.entries(tempRanges)) {
    console.log(`  ${k.padEnd(8)} ${v} (${((v / total) * 100).toFixed(1)}%)`);
  }
  console.log(`\nRain distribution:`);
  for (const [k, v] of Object.entries(rainBuckets)) {
    console.log(`  ${k.padEnd(12)} ${v} (${((v / total) * 100).toFixed(1)}%)`);
  }
  console.log(`\nWind distribution:`);
  for (const [k, v] of Object.entries(windBuckets)) {
    console.log(`  ${k.padEnd(12)} ${v} (${((v / total) * 100).toFixed(1)}%)`);
  }
  console.log(`\nTop weather conditions:`);
  const sorted = Object.entries(weatherCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [k, v] of sorted) {
    console.log(`  ${k.padEnd(20)} ${v} (${((v / total) * 100).toFixed(1)}%)`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────
const command = process.argv[2] || 'status';

switch (command) {
  case 'collect':
    collectWeather().catch(console.error);
    break;
  case 'upcoming':
    collectUpcoming().catch(console.error);
    break;
  case 'status':
    showStatus().catch(console.error);
    break;
  case 'stats':
    showStats();
    break;
  default:
    console.log('Usage: node worker/collect-weather.js [collect|upcoming|status|stats]');
}
