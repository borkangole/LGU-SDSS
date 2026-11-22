// Circular score ring (like the mockup)
export default function ScoreRing({ score, max = 100, color }) {
  // Convert 0-100 to 0-10 for display
  const display  = (score / 10).toFixed(1);
  const pct      = score / max;
  const radius   = 45;
  const circ     = 2 * Math.PI * radius;
  const dash     = pct * circ;
  const gap      = circ - dash;

  return (
    <div style={{ position: "relative", width: 110, height: 110 }}>
      <svg width="110" height="110" style={{ transform: "rotate(-90deg)" }}>
        {/* Background circle */}
        <circle cx="55" cy="55" r={radius}
          fill="none" stroke="#e0e0e0" strokeWidth="8" />
        {/* Score arc */}
        <circle cx="55" cy="55" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeDasharray={`${dash} ${gap}`}
          strokeLinecap="round"
        />
      </svg>
      {/* Center text */}
      <div style={{
        position:  "absolute", top: 0, left: 0,
        width: "100%", height: "100%",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: 24, fontWeight: "bold", color }}>
          {display}
        </span>
        <span style={{ fontSize: 11, color: "#888" }}>/ 10</span>
      </div>
    </div>
  );
}