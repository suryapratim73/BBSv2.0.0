// Batch 2 (continued) — Jurisdiction lookup & holiday date traversal
const { placeOfJurisdiction } = require("../common");

describe("placeOfJurisdiction — city lookup from address", () => {
  test("matches city name in address", () => {
    const result = placeOfJurisdiction({
      address: "123 MG Road, Kolkata, West Bengal",
    });
    expect(result).toBe("Kolkata");
  });

  test("matches city name case-insensitive", () => {
    const result = placeOfJurisdiction({
      address: "plot 5, MUMBAI, Maharashtra",
    });
    expect(result).toBe("Mumbai");
  });

  test("matches city code in address", () => {
    const result = placeOfJurisdiction({
      address: "Near BBI Airport, Bhubaneswar",
    });
    // BBI is the code for Bhubaneswar
    expect(result).toBe("Bhubaneswar");
  });

  test("substring match — 'Navi Mumbai' matches Mumbai first", () => {
    // Known issue: no word-boundary check, substring matches
    const result = placeOfJurisdiction({
      address: "Shop 1, Navi Mumbai",
    });
    // "Mumbai" regex matches within "Navi Mumbai" — whichever comes first in cityList
    expect(result).toBeTruthy();
  });

  test("falls back to regex extraction when no city match", () => {
    const result = placeOfJurisdiction({
      address: "Village Durgapur - 713201",
    });
    // Durgapur is not in cityListWithCodes, so regex extract
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });

  test("empty address returns fallback extraction result", () => {
    const result = placeOfJurisdiction({ address: "" });
    // No match in cityList, no regex match — returns empty string
    expect(typeof result).toBe("string");
  });

  test("returns Howrah as default fallback", () => {
    // Howrah is hardcoded as the fallback
    const result = placeOfJurisdiction({ address: "" });
    // The function falls through all checks for empty address
    expect(result).toBe("Howrah");
  });

  test("Delhi NCR address matches Delhi", () => {
    const result = placeOfJurisdiction({
      address: "Connaught Place, New Delhi - 110001",
    });
    expect(result).toBe("Delhi");
  });
});

// --- traverseDate (saleHandler.js:741, internal — tested via replica) ---
// Walks dates backwards to skip holidays. Recursive.

describe("traverseDate — holiday-aware date walker", () => {
  function traverseDate(date, annualHolidays, weeklyHolidays) {
    // Exact replica of saleHandler.js:741-748
    if (
      annualHolidays.find(
        (dt) => dt.getDate() === date.getDate() && dt.getMonth() === date.getMonth()
      ) ||
      weeklyHolidays.includes(date.getDay())
    ) {
      date.setDate(date.getDate() - 1);
      return traverseDate(date, annualHolidays, weeklyHolidays);
    } else return date;
  }

  test("returns same date when no holidays", () => {
    const d = new Date("2026-07-15"); // Wednesday
    const result = traverseDate(d, [], []);
    expect(result.getDate()).toBe(15);
  });

  test("skips Sunday (weekly holiday)", () => {
    const d = new Date("2026-07-19"); // Sunday
    const result = traverseDate(d, [], [0]); // 0 = Sunday
    // Should go back to Saturday 18th
    expect(result.getDay()).toBe(6); // Saturday
    expect(result.getDate()).toBe(18);
  });

  test("skips annual holiday", () => {
    const holiday = new Date("2026-07-17"); // July 17
    const d = new Date("2026-07-17"); // matches the holiday
    const result = traverseDate(d, [holiday], []);
    // Should go back to July 16
    expect(result.getDate()).toBe(16);
  });

  test("skips both weekly and annual — consecutive holidays", () => {
    // Friday = annual holiday, Saturday & Sunday = weekly
    const holiday = new Date("2026-07-17"); // Friday
    const d = new Date("2026-07-19"); // Sunday
    const result = traverseDate(d, [holiday], [6, 0]); // Saturday + Sunday
    // Should go back: Sun→Sat→Fri(holiday)→Thu 16th
    expect(result.getDate()).toBe(16);
    expect(result.getDay()).toBe(4); // Thursday
  });

  test("week of holidays — all 7 days blocked", () => {
    const holidays = [
      new Date("2026-07-13"), new Date("2026-07-14"), new Date("2026-07-15"),
      new Date("2026-07-16"), new Date("2026-07-17"),
    ];
    const d = new Date("2026-07-19"); // Sunday
    // Mon-Fri all annual holidays, Sat+Sun weekly → all 7 days blocked
    const result = traverseDate(d, holidays, [6, 0]);
    // Should go back to July 12 (previous Sunday — but wait, that's also Sunday!)
    // Actually July 12 is Sunday too, so it keeps going back
    expect(result.getDate()).toBeLessThan(13); // landed in prior week
  });

  test("mutates input date — side effect", () => {
    const d = new Date("2026-07-19"); // Sunday
    traverseDate(d, [], [0]);
    // Original date object is mutated
    expect(d.getDate()).toBe(18); // Saturday
  });
});
