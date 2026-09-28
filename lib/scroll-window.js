'use strict';

// The first row to show of a list taller than the room it has, keeping the
// cursor on screen: the list scrolls only when the cursor would leave it, and
// never past its own end.
//
//   scrollTop(20, 12, 8, 0) → 5   (rows 5–12 visible, cursor on the last)
//   scrollTop(20, 3, 8, 5)  → 3   (cursor moved above the window)
//   scrollTop(6, 5, 8, 0)   → 0   (everything fits)
function scrollTop(count, cursor, room, top) {
  if (count <= room) return 0;
  let next = top;
  if (cursor < next) next = cursor;
  if (cursor >= next + room) next = cursor - room + 1;
  return Math.min(Math.max(next, 0), count - room);
}

module.exports = { scrollTop };
