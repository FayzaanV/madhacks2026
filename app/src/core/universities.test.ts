import { describe, expect, it } from "vitest";
import { OTHER_SCHOOL, schoolForEmail } from "./universities";

const ok = (email: string, school: string) => {
  const r = schoolForEmail(email, school);
  if ("error" in r) throw new Error(r.error);
  return r.school.school_id;
};
const err = (email: string, school: string) => {
  const r = schoolForEmail(email, school);
  return "error" in r ? r.error : null;
};

describe("schoolForEmail", () => {
  it("accepts a listed school's domain and its subdomains", () => {
    expect(ok("bucky@wisc.edu", "uw-madison")).toBe("uw-madison");
    expect(ok("bucky@cs.wisc.edu", "uw-madison")).toBe("uw-madison");
  });
  it("rejects another school's domain or look-alikes", () => {
    expect(err("bucky@umich.edu", "uw-madison")).toMatch(/@wisc\.edu/);
    expect(err("bucky@notwisc.edu", "uw-madison")).toMatch(/@wisc\.edu/);
    expect(err("bucky@wisc.edu.evil.com", "uw-madison")).toMatch(/@wisc\.edu/);
  });
  it("other: any .edu, mapped to a listed school when the domain matches", () => {
    expect(ok("a@cs.stanford.edu", OTHER_SCHOOL)).toBe("stanford");
    expect(ok("a@uchicago.edu", OTHER_SCHOOL)).toBe("edu-uchicago");
    expect(err("a@gmail.com", OTHER_SCHOOL)).toMatch(/\.edu/);
  });
  it("requires a known school id", () => {
    expect(err("a@wisc.edu", "nope")).toMatch(/Pick your university/);
  });
});
