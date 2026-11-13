// Procedural test chart: high-contrast tangential edges show lateral CA best.

export function makeTestChart(w = 2400, h = 1600) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  const cx = w / 2;
  const cy = h / 2;

  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);

  // Concentric rings: edges perpendicular to the radius, ideal for lateral CA.
  g.strokeStyle = '#fff';
  for (let r = 100; r < Math.hypot(cx, cy); r += 140) {
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
  }

  // Grid of point lights.
  g.fillStyle = '#fff';
  for (let y = 60; y < h; y += 120) {
    for (let x = 60; x < w; x += 120) {
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.fill();
    }
  }

  // Solid squares in corners and along edges (white on black and black on white).
  const sq = 180;
  const spots = [
    [0.12, 0.15], [0.88, 0.15], [0.12, 0.85], [0.88, 0.85],
    [0.5, 0.12], [0.5, 0.88], [0.08, 0.5], [0.92, 0.5],
  ];
  spots.forEach(([fx, fy], i) => {
    const x = fx * w - sq / 2;
    const y = fy * h - sq / 2;
    g.fillStyle = '#fff';
    g.fillRect(x, y, sq, sq);
    if (i < 4) {
      g.fillStyle = '#000';
      g.fillRect(x + sq * 0.3, y + sq * 0.3, sq * 0.4, sq * 0.4);
    }
  });

  // Text.
  g.fillStyle = '#fff';
  g.font = 'bold 120px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('CHROMATIC', cx, cy - 300);
  g.font = '48px system-ui, sans-serif';
  g.fillText('lateral aberration test chart', cx, cy + 300);

  // Thin lines near the edges.
  g.fillStyle = '#fff';
  for (let i = 0; i < 12; i++) {
    g.fillRect(w * 0.25 + i * 24, h * 0.03, 6, 80);
    g.fillRect(w * 0.25 + i * 24, h * 0.97 - 80, 6, 80);
  }

  return cv;
}
