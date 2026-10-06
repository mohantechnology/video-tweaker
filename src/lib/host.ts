const COMPOUND_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "co.jp",
  "co.kr",
  "co.in",
  "co.id",
  "com.au",
  "net.au",
  "org.au",
  "com.br",
  "com.mx",
  "co.nz",
  "co.za",
  "com.tr",
  "com.sg",
  "com.hk",
  "com.tw",
  "com.ar",
  "com.my"
])

export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "")
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host
  const parts = host.split(".").filter(Boolean)
  if (parts.length <= 2) return parts.join(".")
  const lastTwo = parts.slice(-2).join(".")
  if (COMPOUND_SUFFIXES.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join(".")
  return lastTwo
}
