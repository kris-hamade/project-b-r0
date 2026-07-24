function rollDice(notation, rng = Math.random) {
  const input = String(notation || '').replace(/\s+/g, '').toLowerCase();
  if (!input || input.length > 100 || !/^[+-]?(?:\d*d\d+|\d+)(?:[+-](?:\d*d\d+|\d+))*$/.test(input)) {
    throw new Error('Use dice notation such as 1d20+5 or 2d6+1d4-2.');
  }

  const terms = input.match(/[+-]?(?:\d*d\d+|\d+)/g) || [];
  if (terms.length > 20) throw new Error('Too many dice terms.');
  let total = 0;
  const expanded = [];

  for (const rawTerm of terms) {
    const sign = rawTerm.startsWith('-') ? -1 : 1;
    const term = rawTerm.replace(/^[+-]/, '');
    if (term.includes('d')) {
      const [countRaw, sidesRaw] = term.split('d');
      const count = Number(countRaw || 1);
      const sides = Number(sidesRaw);
      if (!Number.isInteger(count) || !Number.isInteger(sides) || count < 1 || count > 100 || sides < 2 || sides > 100000) {
        throw new Error('Dice must use 1-100 dice with 2-100000 sides.');
      }
      const rolls = Array.from({ length: count }, () => Math.floor(rng() * sides) + 1);
      const subtotal = rolls.reduce((sum, value) => sum + value, 0) * sign;
      total += subtotal;
      expanded.push(`${sign < 0 ? '-' : expanded.length ? '+' : ''}[${rolls.join(', ')}]`);
    } else {
      const value = Number(term) * sign;
      total += value;
      expanded.push(`${value >= 0 && expanded.length ? '+' : ''}${value}`);
    }
  }

  return { total, expanded: expanded.join(' ') };
}

module.exports = { rollDice };
