// Import Mapbox and D3 as ES modules
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Set your Mapbox access token here
mapboxgl.accessToken =
  'pk.eyJ1IjoidGlub2NvMTA3IiwiYSI6ImNtYXJmNTl6ZDA5encya29oYjkwcHN4dmIifQ.sahJQC_QsP95q5VvjSbkmA';

/*–– Global Helper Functions ––*/

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id
  );
  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id
  );
  return stations.map((station) => {
    const id = station.short_name;
    station.departures = departures.get(id) ?? 0;
    station.arrivals = arrivals.get(id) ?? 0;
    station.totalTraffic = station.departures + station.arrivals;
    return station;
  });
}

function filterTripsByTime(trips, timeFilter) {
  if (timeFilter === -1) return trips;
  return trips.filter((trip) => {
    const startedMinutes = minutesSinceMidnight(trip.started_at);
    const endedMinutes = minutesSinceMidnight(trip.ended_at);
    return (
      Math.abs(startedMinutes - timeFilter) <= 60 ||
      Math.abs(endedMinutes - timeFilter) <= 60
    );
  });
}

/*–– End Global Helpers ––*/

// Initialize map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});
console.log('Map created:', map);

function getCoords(station) {
  const lon = +station.lon;
  const lat = +station.lat;
  if (isNaN(lon) || isNaN(lat)) return { cx: -100, cy: -100 };
  const point = new mapboxgl.LngLat(lon, lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// Bike lane styles
const bostonBikeLaneStyle = { 'line-color': 'green', 'line-width': 3, 'line-opacity': 0.4 };
const cambridgeBikeLaneStyle = { 'line-color': '#32D400', 'line-width': 5, 'line-opacity': 0.6 };

// Define a quantize scale for traffic flow.
// It takes an input ratio from 0 to 1 and maps it to one of three discrete outputs: 0, 0.5, or 1.
let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

// Global variables
let trips = []; 
let originalStations = []; 
const radiusScale = d3.scaleSqrt(); 
let circles;

map.on('load', async () => {
  // --------- Bike Lane Layers ---------
  map.addSource('boston_route', {
    type: 'geojson',
    data:
      'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });
  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: bostonBikeLaneStyle,
  });
  map.addSource('cambridge_route', {
    type: 'geojson',
    data:
      'https://bostonopendata-boston.opendata.arcgis.com/datasets/cambridge-bike-lane-data.geojson',
  });
  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: cambridgeBikeLaneStyle,
  });
  console.log('Bike lanes layers have been added.');

  // --------- Fetch Station Data ---------
  let stations = [];
  try {
    const stationJsonUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    const stationData = await d3.json(stationJsonUrl);
    stations = stationData.data.stations;
    console.log('Stations Array:', stations);
  } catch (error) {
    console.error('Error loading station JSON:', error);
  }
  // Filter out stations with invalid coordinates.
  const validStations = stations.filter((d) => !isNaN(+d.lon) && !isNaN(+d.lat));
  originalStations = validStations;

  // --------- Create SVG Overlay and Initial Markers ---------
  let svg = d3.select('#map').select('svg');
  if (svg.empty()) {
    svg = d3.select('#map').append('svg').attr('class', 'overlay');
  }
  // Bind station markers using a key (short_name)
  circles = svg
    .selectAll('circle')
    .data(originalStations, (d) => d.short_name)
    .enter()
    .append('circle')
    .attr('r', 5)
    .attr('fill', 'steelblue')
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('opacity', 0.8)
    // Set initial departure ratio variable via CSS custom property
    .style('--departure-ratio', (d) =>
      stationFlow(d.totalTraffic ? d.departures / d.totalTraffic : 0)
    )
    .each(function (d) {
      d3.select(this)
        .append('title')
        .text(
          `${d.totalTraffic || 0} trips (${d.departures || 0} departures, ${d.arrivals || 0} arrivals)`
        );
    });

  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }
  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);
  console.log('Station markers have been added and positioned.');

  // --------- Fetch Trip Data (Traffic CSV) ---------
  try {
    const trafficUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';
    trips = await d3.csv(trafficUrl, (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      return trip;
    });
    console.log('Loaded Traffic Trips:', trips);
  } catch (error) {
    console.error('Error loading traffic CSV:', error);
  }

  // Configure radiusScale based on full trip data
  const allStations = computeStationTraffic(originalStations, trips);
  radiusScale.domain([0, d3.max(allStations, (d) => d.totalTraffic)]);
  radiusScale.range([0, 25]); // No filtering => standard size

  // Compute station traffic with full trip data and update markers
  originalStations = computeStationTraffic(originalStations, trips);
  circles.attr('r', (d) => radiusScale(d.totalTraffic));

  // --------- Define updateScatterPlot() for Filtering ---------
  function updateScatterPlot(timeFilter) {
    const filteredTrips = filterTripsByTime(trips, timeFilter);
    const filteredStations = computeStationTraffic(originalStations, filteredTrips);
    // Dynamically change radius range when filtering
    if (timeFilter === -1) {
      radiusScale.range([0, 25]);
    } else {
      radiusScale.range([3, 50]);
    }
    circles = svg
      .selectAll('circle')
      .data(filteredStations, (d) => d.short_name)
      .join('circle')
      .attr('fill', 'steelblue')
      .attr('stroke', 'white')
      .attr('stroke-width', 1)
      .attr('opacity', 0.8)
      .attr('r', (d) => radiusScale(d.totalTraffic))
      // Set CSS variable for departure ratio (ensure denominator is non-zero)
      .style('--departure-ratio', (d) =>
        stationFlow(d.totalTraffic ? d.departures / d.totalTraffic : 0)
      )
      .each(function (d) {
        d3.select(this)
          .select('title')
          .text(
            `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
          );
      });
    updatePositions();
  }

  // --------- Reactivity: Connect Slider to Filtering ---------
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('time-display');
  const anyTimeLabel = document.getElementById('any-time');
  let timeFilter = Number(timeSlider.value);
  function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);
    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }
    // Trigger scatterplot update after slider change
    updateScatterPlot(timeFilter);
  }
  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});
