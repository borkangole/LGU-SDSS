// Official barangay names (PSA) of San Miguel, Iloilo, keyed by the
// normalized name the map uses ("Bgy. 1 Pob." / "Brgy 1" / "Barangay 1" -> "1",
// "Santo Angel" / "Brgy Sto Angel" -> "sto angel").
export const OFFICIAL_BARANGAY_NAME = {
  ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [String(i + 1), i + 1 === 10 ? "Bgy. 10" : `Bgy. ${i + 1} Pob.`])),
  "consolacion": "Consolacion", "igtambo": "Igtambo", "san antonio": "San Antonio", "san jose": "San Jose",
  "sta cruz": "Santa Cruz", "sta teresa": "Santa Teresa", "sto angel": "Santo Angel", "sto nino": "Santo Niño",
};
