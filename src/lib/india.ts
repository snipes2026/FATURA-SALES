/** GST state codes (first 2 digits of a GSTIN). */
export const GST_STATES: Record<string, string> = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman & Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

export const STATE_OPTIONS = Object.entries(GST_STATES).map(([value, name]) => ({ value, label: `${value} – ${name}` }));

export const stateName =(code?: string | null) => (code ? (GST_STATES[code] ?? code) : "");

/** 15-char GSTIN: 2-digit state, 10-char PAN, entity no., 'Z', checksum. */
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** GSTIN checksum (mod-36 algorithm used by GSTN). */
export function isValidGstin(gstin: string): boolean {
  const g = gstin.trim().toUpperCase();
  if (!GSTIN_REGEX.test(g) || !GST_STATES[g.slice(0, 2)]) return false;
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = chars.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  const check = chars[(36 - (sum % 36)) % 36];
  return check === g[14];
}

export const stateFromGstin = (gstin?: string | null) =>
  gstin && gstin.length >= 2 ? gstin.slice(0, 2) : null;

/** GST rates allowed on departments. 40% added for GST 2.0 (Sept 2025). */
export const GST_RATES = [0, 5, 12, 18, 28, 40] as const;

const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 125000 -> "1,25,000.00" */
export const formatAmount = (v: number | string | null | undefined) => inr.format(Number(v ?? 0));
/** 125000 -> "₹1,25,000.00" */
export const formatINR = (v: number | string | null | undefined) => `₹${formatAmount(v)}`;
