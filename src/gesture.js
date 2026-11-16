const DISTANCE = 60;

function slotFromMotion(origin, point) {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  if (dx * dx + dy * dy < DISTANCE * DISTANCE) return -1;
  return (Math.round((Math.atan2(dy, dx) + Math.PI / 2) / (Math.PI / 4)) + 8) % 8;
}

module.exports = { slotFromMotion };
