const assert = require('assert');

// Mock parser logic to develop and verify
function parseCookieInput(rawInput, options = {}) {
  if (!rawInput) return [];
  
  // 1. If direct array of accounts
  if (Array.isArray(rawInput)) {
    // Check if it's Cookie-Editor format (array of { name, value })
    if (rawInput.length > 0 && rawInput.every(item => item && (item.name || item.Name) && (item.value !== undefined || item.Value !== undefined))) {
      const cookieStr = rawInput
        .map(c => `${c.name || c.Name}=${c.value !== undefined ? c.value : c.Value}`)
        .join('; ');
      return [{
        cookieStr,
        detectedFormat: 'json_cookie_editor',
        options
      }];
    }
    // Otherwise standard array of accounts
    return rawInput.map(item => ({
      username: item.username || item.name,
      email: item.email,
      phone: item.phone || item.phoneNumber,
      cookieStr: (item.cookies || item.cookie || '').trim(),
      detectedFormat: 'account_array_json',
      options
    })).filter(a => a.cookieStr.length > 5);
  }

  if (typeof rawInput !== 'string') return [];
  const trimmed = rawInput.trim();
  if (!trimmed) return [];

  // 2. Check JSON Array string
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parseCookieInput(parsed, options);
      }
    } catch (e) {}
  }

  // 3. Check cURL format
  const curlCookieMatch = trimmed.match(/(?:-H|--header)\s+['"](?:cookie|Cookie):\s*([^'"]+)['"]/i);
  if (curlCookieMatch && curlCookieMatch[1]) {
    return [{
      cookieStr: curlCookieMatch[1].trim(),
      detectedFormat: 'curl_command',
      options
    }];
  }

  // 4. Check "Cookie: ..." header format (single or multi-line)
  const headerMatch = trimmed.match(/^(?:Cookie|cookie):\s*(.+)$/im);
  if (headerMatch && headerMatch[1] && !trimmed.includes('\t')) {
    return [{
      cookieStr: headerMatch[1].trim(),
      detectedFormat: 'cookie_header',
      options
    }];
  }

  // 5. Check Chrome DevTools Cookie Table Format (Tab-separated)
  // Lines contain tabs, column 0 is cookie name, column 1 is cookie value
  const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const tabLines = lines.filter(l => l.includes('\t'));

  if (tabLines.length > 0) {
    // Process tab-separated table
    // Can have multiple accounts separated by delimiters (e.g. "===", "---", or pipe header)
    const accountBlocks = [];
    let currentBlock = [];

    for (const line of lines) {
      if (/^(=+|-+|#|\/\/)|\bAkun\s+\d+/i.test(line) && currentBlock.length > 0) {
        accountBlocks.push(currentBlock);
        currentBlock = [];
        continue;
      }
      currentBlock.push(line);
    }
    if (currentBlock.length > 0) accountBlocks.push(currentBlock);

    const results = [];
    for (const block of accountBlocks) {
      const cookieMap = new Map();
      let customUser = null;
      let customEmail = null;

      for (const line of block) {
        if (!line.includes('\t')) {
          if (line.includes('|')) {
            const parts = line.split('|').map(p => p.trim());
            if (parts.length >= 2) {
              customUser = parts[0];
              customEmail = parts[1];
            }
          }
          continue;
        }

        const cols = line.split('\t').map(c => c.trim());
        const name = cols[0];
        const val = cols[1];
        const domain = cols[2] || '';

        // Skip header row if copied with headers
        if (name.toLowerCase() === 'name' && (val || '').toLowerCase() === 'value') continue;
        if (!name || val === undefined) continue;

        // If duplicate name (e.g. SPC_SEC_SI for seller vs shopee), prefer shopee.co.id
        if (!cookieMap.has(name) || domain.includes('shopee.co.id') && !domain.includes('seller')) {
          cookieMap.set(name, val);
        }
      }

      if (cookieMap.size > 0) {
        const cookiePairs = [];
        for (const [k, v] of cookieMap.entries()) {
          cookiePairs.push(`${k}=${v}`);
        }
        results.push({
          username: customUser,
          email: customEmail,
          cookieStr: cookiePairs.join('; ') + ';',
          detectedFormat: 'chrome_devtools_table',
          cookieCount: cookieMap.size,
          options
        });
      }
    }

    if (results.length > 0) return results;
  }

  // 6. Pipe-separated lines or Standard line-by-line cookies
  const results = [];
  for (const line of lines) {
    if (/^(=+|-+|#|\/\/)/.test(line)) continue;
    let username = null;
    let email = null;
    let phone = null;
    let cookieStr = null;

    if (line.includes('|')) {
      const parts = line.split('|').map(p => p.trim());
      if (parts.length >= 3) {
        username = parts[0];
        email = parts[1];
        cookieStr = parts[2];
        if (parts.length >= 4) phone = parts[3];
      } else if (parts.length === 2) {
        username = parts[0];
        cookieStr = parts[1];
      }
    } else {
      cookieStr = line;
    }

    if (!cookieStr || cookieStr.length < 5) continue;
    // Strip leading "Cookie:" if present
    cookieStr = cookieStr.replace(/^(?:Cookie|cookie):\s*/i, '').trim();

    results.push({
      username,
      email,
      phone,
      cookieStr,
      detectedFormat: line.includes('|') ? 'pipe_separated' : 'semicolon_string',
      options
    });
  }

  return results;
}

// TEST CASES
console.log('Testing parseCookieInput...');

// Case 1: Chrome DevTools table copy (as user pasted!)
const chromeCopy = `SPC_CDS_CHAT\t87b0ccaa-c733-4712-8f96-8a02a0a6e4e9\t.shopee.co.id\t/\tSession\t48\tMedium
SPC_CLIENTID\tbVVTc01vSm9CanFGwiefzqoexvlxauxn\t.shopee.co.id\t/\t2027-10-18T07:38:09.039Z\t44\tMedium
SPC_F\tmUSsMoJoBjqFZvkyguJLhfw9yTS7m8JE\t.shopee.co.id\t/\t2027-10-18T07:37:03.664Z\t37\tMedium
SPC_R_T_ID\tOlmVUBdetpbTt+QdjeTTKIA9xVG036OVl/t0t2BS3IdTUpUMIlBTHhsrpxkioHJbGErLDaVXumyWVJznpFyhXze4CksPNzPEGspPCbaW0pENA94NEBSdLG5AbLy5C0JMykKZ+3NudnYRTRP4AQoAiC5vIPlQ6BNx1Uz0BSqe6XI=\t.shopee.co.id\t/\t2027-10-18T08:05:25.860Z\t182\tMedium
SPC_R_T_IV\takhEMmxHdVppTXZwRW5rcA==\t.shopee.co.id\t/\t2027-10-18T08:05:25.860Z\t34\tMedium
SPC_SEC_SI\tv1-OHB6ZHZMU3R0N2NDSzRxUHtDuuOklN+q5WrrN1xiLC7u0n8RThreDP2R9qQrMVLxxqgq6vExoNK8/Vp+WjfTbQ5SVbAslAsw2zPoHAHbR9s=\tshopee.co.id\t/\t2026-09-14T07:42:38.091Z\t121\tMedium`;

const res1 = parseCookieInput(chromeCopy);
assert.strictEqual(res1.length, 1);
assert.strictEqual(res1[0].detectedFormat, 'chrome_devtools_table');
assert.ok(res1[0].cookieStr.includes('SPC_CDS_CHAT=87b0ccaa-c733-4712-8f96-8a02a0a6e4e9'));
assert.ok(res1[0].cookieStr.includes('SPC_CLIENTID=bVVTc01vSm9CanFGwiefzqoexvlxauxn'));
assert.ok(res1[0].cookieStr.includes('SPC_F=mUSsMoJoBjqFZvkyguJLhfw9yTS7m8JE'));
assert.ok(res1[0].cookieStr.includes('SPC_R_T_ID=OlmVUBdetpbTt+QdjeTTKIA9xVG036OVl'));
assert.ok(res1[0].cookieStr.includes('SPC_SEC_SI=v1-OHB6ZHZMU3R0N2NDSzRxUHtDuuOklN'));
console.log('Case 1 (Chrome DevTools table): PASS! Total cookies in account:', res1[0].cookieCount);

// Case 2: cURL string
const curlStr = `curl 'https://live.shopee.co.id/api/v1/session/123' -H 'cookie: SPC_F=test1234; SPC_R_T_ID=token5678;'`;
const res2 = parseCookieInput(curlStr);
assert.strictEqual(res2.length, 1);
assert.strictEqual(res2[0].detectedFormat, 'curl_command');
assert.strictEqual(res2[0].cookieStr, 'SPC_F=test1234; SPC_R_T_ID=token5678;');
console.log('Case 2 (cURL): PASS!');

// Case 3: Cookie-Editor JSON array
const jsonCookieEditor = JSON.stringify([
  { name: 'SPC_F', value: 'device_123', domain: '.shopee.co.id' },
  { name: 'SPC_R_T_ID', value: 'session_456', domain: '.shopee.co.id' }
]);
const res3 = parseCookieInput(jsonCookieEditor);
assert.strictEqual(res3.length, 1);
assert.strictEqual(res3[0].detectedFormat, 'json_cookie_editor');
assert.ok(res3[0].cookieStr.includes('SPC_F=device_123'));
assert.ok(res3[0].cookieStr.includes('SPC_R_T_ID=session_456'));
console.log('Case 3 (Cookie-Editor JSON): PASS!');

// Case 4: Pipe separated
const pipeStr = `budi_shopee | budi@gmail.com | SPC_U=123; SPC_EC=token;`;
const res4 = parseCookieInput(pipeStr);
assert.strictEqual(res4.length, 1);
assert.strictEqual(res4[0].username, 'budi_shopee');
assert.strictEqual(res4[0].email, 'budi@gmail.com');
assert.strictEqual(res4[0].cookieStr, 'SPC_U=123; SPC_EC=token;');
console.log('Case 4 (Pipe separated): PASS!');

console.log('ALL TEST CASES PASSED! 🎉');
