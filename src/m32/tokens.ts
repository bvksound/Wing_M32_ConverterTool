/**
 * Value encoders / decoders for the M32 `.scn` token grammar.
 * See FORMATS.md for the format itself.
 */

/** Decode a level token: "-oo" => -Infinity, "-4.5" / "+0" => number dB. */
export function decodeLevel(token: string): number {
  if (token === "-oo" || token === "-∞") return -Infinity;
  const n = Number(token);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Encode dB back to an M32 level token. The console prints one decimal and a
 * sign for non-negative values on send/pan fields; faders use the same.
 * Levels at or below -90 dB collapse to "-oo".
 */
export function encodeLevel(db: number, signed = false): string {
  if (!Number.isFinite(db) || db <= -90) return "-oo";
  const rounded = Math.round(db * 10) / 10;
  const body = Math.abs(rounded).toFixed(1);
  if (rounded < 0) return `-${body}`;
  return signed ? `+${body}` : body;
}

/** Encode a signed value with no forced decimals (pan, some gains): "+0", "-12". */
export function encodeSigned(value: number): string {
  const rounded = Math.round(value);
  return rounded < 0 ? `${rounded}` : `+${rounded}`;
}

/** Decode a frequency token: "3k94" => 3940, "158.9" => 158.9, "20k00" => 20000. */
export function decodeFreq(token: string): number {
  const m = /^(\d+)k(\d+)$/.exec(token);
  if (m) {
    const whole = Number(m[1]);
    const frac = m[2] ?? "0";
    return whole * 1000 + Number(frac) * 10 ** (3 - frac.length);
  }
  const n = Number(token);
  return Number.isNaN(n) ? 0 : n;
}

/** Encode hertz to an M32 frequency token. */
export function encodeFreq(hz: number): string {
  if (hz < 1000) {
    return (Math.round(hz * 10) / 10).toFixed(1);
  }
  const whole = Math.floor(hz / 1000);
  const frac = Math.round((hz - whole * 1000) / 10); // 0..99
  return `${whole}k${frac.toString().padStart(2, "0")}`;
}

/**
 * "%00000001" => bitmask number. The mask is written most-significant bit
 * first (standard binary reading), so the *last* character is bit 0 — e.g.
 * `%000001` = DCA/mute-group 1, `%10000000` = DCA 8.
 */
export function decodeMask(token: string): number {
  const bits = token.startsWith("%") ? token.slice(1) : token;
  let mask = 0;
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === "1") mask |= 1 << (bits.length - 1 - i);
  }
  return mask;
}

/** Inverse of decodeMask. `width` = number of bits to emit. */
export function encodeMask(mask: number, width: number): string {
  let out = "%";
  for (let i = width - 1; i >= 0; i--) {
    out += mask & (1 << i) ? "1" : "0";
  }
  return out;
}

export function decodeBool(token: string): boolean {
  return token === "ON";
}

export function encodeBool(value: boolean): string {
  return value ? "ON" : "OFF";
}

/** Strip surrounding double quotes from a token. */
export function unquote(token: string): string {
  if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) {
    return token.slice(1, -1);
  }
  return token;
}

export function quote(value: string): string {
  return `"${value}"`;
}

/**
 * Split an M32 argument string into tokens, keeping quoted strings (which may
 * contain spaces) as a single token *including* their quotes.
 */
export function tokenizeArgs(argStr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const s = argStr;
  while (i < s.length) {
    while (i < s.length && s[i] === " ") i++;
    if (i >= s.length) break;
    if (s[i] === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j++;
      tokens.push(s.slice(i, Math.min(j + 1, s.length)));
      i = j + 1;
    } else {
      let j = i;
      while (j < s.length && s[j] !== " ") j++;
      tokens.push(s.slice(i, j));
      i = j;
    }
  }
  return tokens;
}
