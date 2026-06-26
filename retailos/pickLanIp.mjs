import os from 'node:os'

/**
 * One address to show for “open this on another PC on the same LAN”.
 * Set RETAILOS_LAN_IP=192.168.x.x if the machine has several NICs and auto-pick is wrong.
 */
export function pickPrimaryLanIp() {
  const env = typeof process !== 'undefined' && process.env?.RETAILOS_LAN_IP?.trim()
  if (env) return env

  const candidates = []
  for (const nets of Object.values(os.networkInterfaces())) {
    if (!nets) continue
    for (const n of nets) {
      const v4 = n.family === 'IPv4' || n.family === 4
      if (!v4 || n.internal) continue
      const a = n.address
      if (a.startsWith('169.254.')) continue
      candidates.push(a)
    }
  }

  const score = (ip) => {
    if (ip.startsWith('192.168.')) return 4
    if (ip.startsWith('10.')) return 3
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return 3
    return 1
  }
  candidates.sort((a, b) => score(b) - score(a) || a.localeCompare(b))
  return candidates[0] || '127.0.0.1'
}
