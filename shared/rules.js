import { colorOf } from './physics.js';

export function remaining(balls, color) {
  return balls.filter((b) => b.color === color && !b.pocketed).length;
}

// Colour groups are fixed when players join. Only the FIRST contact must be
// your colour; combinations may subsequently contact either group.
export function resolveShot({ balls, color, firstHit, pocketed, onBlack, railAfterContact }) {
  let foul = null;
  if (pocketed.includes(0)) foul = 'The cue ball was potted.';
  else if (firstHit == null) foul = 'The cue ball missed every ball.';
  else if (onBlack ? firstHit !== 8 : colorOf(firstHit) !== color) {
    foul = firstHit === 8 ? 'The black was hit before your colours were cleared.' : `Your first contact must be ${onBlack ? 'the black' : 'a ' + color + ' ball'}.`;
  } else if (pocketed.length === 0 && !railAfterContact) {
    foul = 'After contact, a ball must reach a cushion or a pocket.';
  }
  if (pocketed.includes(8)) {
    const won = onBlack && !foul && remaining(balls, color) === 0;
    return { foul, result: won ? 'win' : 'loss', reason: won ? 'All colours cleared. Black down. Beautifully played.' : (foul || 'The black was potted before clearing your colours.'), keepTurn: false };
  }
  return { foul, result: null, keepTurn: !foul && pocketed.some((id) => colorOf(id) === color) };
}
